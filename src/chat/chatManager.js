import tmi from 'tmi.js';
import chalk from 'chalk';
import ShoutoutManager from '../shoutout/shoutoutManager.js';
import BirthdayManager from '../birthdays/birthdayManager.js';

class ChatManager {
  constructor(commandManager, twitchApi, channelName) {
    this.commandManager = commandManager;
    this.twitchApi = twitchApi;
    this.channelName = channelName;
    this.shoutoutManager = new ShoutoutManager();
    this.birthdayManager = new BirthdayManager();
    this.client = null;
    this.moderators = new Set();
  }

  /**
   * Initialise la connexion au chat
   */
  async initialize() {
    try {
      // Récupérer les modérateurs
      await this.loadModerators();

      // Configuration du client TMI
      this.client = new tmi.Client({
        options: { debug: false },
        connection: {
          secure: true,
          reconnect: true,
          maxReconnectAttempts: 5,
          maxReconnectInterval: 30000
        },
        channels: [this.channelName]
      });

      // Événements du chat
      this.client.on('message', this.onMessage.bind(this));
      this.client.on('connected', this.onConnected.bind(this));
      this.client.on('disconnected', this.onDisconnected.bind(this));

      // Connexion
      await this.client.connect();
      
    } catch (error) {
      console.error('❌ Erreur lors de l\'initialisation du chat:', error.message);
      throw error;
    }
  }

  /**
   * Charge la liste des modérateurs
   */
  async loadModerators() {
    try {
      const mods = await this.twitchApi.getModerators();
      this.moderators.clear();
      mods.forEach(mod => this.moderators.add(mod.user_login.toLowerCase()));
      console.log(chalk.blue(`👮 ${this.moderators.size} modérateurs chargés`));
    } catch (error) {
      console.log(chalk.yellow('⚠️  Impossible de charger les modérateurs:', error.message));
    }
  }

  /**
   * Événement de connexion
   */
  onConnected(addr, port) {
    console.log(chalk.green(`💬 Connecté au chat de ${this.channelName} (${addr}:${port})`));
  }

  /**
   * Événement de déconnexion
   */
  onDisconnected(reason) {
    console.log(chalk.yellow(`💬 Déconnecté du chat: ${reason}`));
  }

  /**
   * Traite les messages du chat
   */
  async onMessage(channel, tags, message, self) {
    // Ignorer nos propres messages
    if (self) return;

    const username = tags.username;
    const displayName = tags['display-name'] || username;
    const isModerator = this.moderators.has(username.toLowerCase()) || tags.mod;
    const isBroadcaster = tags.badges && tags.badges.broadcaster;

    // Vérifier si c'est une commande (commence par !)
    if (message.startsWith('!')) {
      const parts = message.split(' ');
      const commandName = parts[0].substring(1); // Enlever le !
      const args = parts.slice(1).join(' '); // Arguments restants
      const lowerName = commandName.toLowerCase();
      console.log(chalk.gray(`🔍 Commande détectée: !${commandName} par ${username} (mod: ${isModerator || isBroadcaster})`));

      // Gestion spéciale pour la commande anniversaire du jour / d'une personne
      if (lowerName === 'anniv') {
        await this.handleAnnivToday(username, args);
        return;
      }

      // Gestion spéciale pour l'enregistrement de son anniversaire
      if (lowerName === 'monanniv') {
        await this.handleAnnivCommand(username, displayName, args);
        return;
      }
      
      const command = this.commandManager.findCommand(commandName, isModerator || isBroadcaster);
      
        if (command) {
          // Vérifier si la commande nécessite des arguments
          if (command.requiresArgs && (!args || args.trim() === '')) {
            console.log(chalk.yellow(`⚠️ Commande !${commandName} nécessite des arguments`));
            return;
          }
          
          // Gestion spéciale pour la commande shoutout
          if (commandName.toLowerCase() === 'so') {
            const targetUsername = args.trim();
            
            // Définir le shoutout actuel dans l'API duc-engine (même si Twitch échoue)
            try {
              await this.shoutoutManager.setCurrentShoutout(targetUsername);
              
              // Programmer l'effacement du shoutout après 1 minute
              setTimeout(async () => {
                try {
                  await this.shoutoutManager.clearCurrentShoutout();
                } catch (err) {
                  console.log(chalk.gray('⚠️  Impossible d\'effacer automatiquement le shoutout'));
                }
              }, 60 * 1000); // 1 minute
              
              console.log(chalk.blue(`💬 Shoutout défini dans l'API duc-engine: ${targetUsername}`));
            } catch (error) {
              console.log(chalk.red(`❌ Erreur définition shoutout API: ${error.message}`));
            }
            
            // Essayer d'envoyer le shoutout à Twitch (optionnel)
            try {
              const targetUserId = await this.getUserIdByUsername(targetUsername);
              if (targetUserId) {
                await this.twitchApi.shoutout(targetUserId);
                console.log(chalk.blue(`💬 Shoutout Twitch envoyé par ${username} à ${targetUsername}`));
              } else {
                console.log(chalk.yellow(`⚠️ Utilisateur ${targetUsername} non trouvé sur Twitch, mais shoutout défini dans l'API`));
              }
            } catch (error) {
              console.log(chalk.yellow(`⚠️ Erreur shoutout Twitch: ${error.message} (mais shoutout défini dans l'API)`));
            }
            
            // Envoyer une réponse aléatoire si disponible
            if (command.response === 'random' && command.randomResponses && command.randomResponses.length > 0) {
              const randomIndex = Math.floor(Math.random() * command.randomResponses.length);
              let response = command.randomResponses[randomIndex];
              
              // Remplacer les variables
              response = response.replace('@username', `@${username}`);
              response = response.replace('$(display_name)', tags['display-name'] || username);
              response = response.replace('$(args)', targetUsername);
              
              // Ajouter /me au début si ce n'est pas déjà présent
              if (!response.startsWith('/me ')) {
                response = `/me ${response}`;
              }
              
              // Envoyer la réponse via l'API Twitch
              try {
                await this.twitchApi.sendChatMessage(response);
                console.log(chalk.blue(`💬 Réponse aléatoire !so envoyée par ${username}: ${response}`));
              } catch (error) {
                console.log(chalk.red(`❌ Erreur envoi message: ${error.message}`));
              }
            }
            
            return;
          }
          
          let response;
          
          // Gérer les réponses automatiques (comme !list)
          if (command.response === 'auto') {
            if (commandName.toLowerCase() === 'list' || commandName.toLowerCase() === 'liste') {
              // Générer automatiquement la liste des commandes globales visibles (!list)
              const globalCommands = this.commandManager.commands.global || {};
              const commandNames = Object.entries(globalCommands)
                .filter(([name, cmd]) => 
                  name.toLowerCase() !== 'list' &&
                  name.toLowerCase() !== 'liste' &&
                  cmd.hideFromList !== true
                )
                .map(([name]) => name)
                .join(' • ');
              response = commandNames || 'Aucune commande disponible';
            } else {
              response = 'Commande automatique non reconnue';
            }
          }
          // Gérer les réponses aléatoires
          else if (command.response === 'random' && command.randomResponses) {
            const randomIndex = Math.floor(Math.random() * command.randomResponses.length);
            response = command.randomResponses[randomIndex];
          } else {
            response = command.response;
          }
        
        // Remplacer les variables
        response = response.replace('@username', `@${username}`);
        response = response.replace('$(display_name)', tags['display-name'] || username);
        response = response.replace('$(args)', args);
        
        // Ajouter /me au début si ce n'est pas déjà présent
        if (!response.startsWith('/me ')) {
          response = `/me ${response}`;
        }
        
        // Envoyer la réponse via l'API Twitch au lieu de TMI
        try {
          await this.twitchApi.sendChatMessage(response);
          console.log(chalk.blue(`💬 Commande !${commandName} exécutée par ${username}: ${response}`));
        } catch (error) {
          console.log(chalk.red(`❌ Erreur envoi message: ${error.message}`));
        }
      } else {
        console.log(chalk.gray(`❌ Commande !${commandName} non trouvée`));
      }
    }
  }

  /**
   * Gestion de la commande !anniv (liste des anniversaires du jour ou d'une personne)
   */
  async handleAnnivToday(username, args) {
    try {
      const all = await this.birthdayManager.load();
      const trimmed = (args || '').trim();

      let msg;

      if (!trimmed) {
        // Mode "aujourd'hui"
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const todayKey = `${dd}/${mm}`;

        const todaysBirthdays = Object.values(all || {}).filter(record => {
          if (!record.date) return false;
          const parts = record.date.split('/');
          if (parts.length !== 3) return false;
          const [d, m] = parts;
          return `${d}/${m}` === todayKey;
        });

        if (todaysBirthdays.length === 0) {
          msg = `/me @${username} il n'y a pas d'anniversaire à fêter aujourd'hui.`;
        } else {
          const names = todaysBirthdays
            .map(r => r.displayName || r.username)
            .join(' • ');
          msg = `/me Anniversaire aujourd'hui pour : ${names} 🎂`;
        }
      } else {
        // Mode "anniversaire d'une personne"
        const targetRaw = trimmed.replace(/^@/, '');
        const target = targetRaw.toLowerCase();

        const records = Object.entries(all || {});
        const foundEntry = records.find(([login, rec]) => {
          if (!rec || !rec.date) return false;
          const loginLc = (login || '').toLowerCase();
          const userLc = (rec.username || '').toLowerCase();
          const dispLc = (rec.displayName || '').toLowerCase();
          return (
            loginLc === target ||
            userLc === target ||
            dispLc === target
          );
        });

        if (!foundEntry) {
          msg = `/me Je n'ai pas d'anniversaire enregistré pour ${targetRaw}. Dis-lui d'utiliser !monanniv JJ/MM/AAAA.`;
        } else {
          const rec = foundEntry[1];
          const name = rec.displayName || rec.username || targetRaw;
          msg = `/me L'anniversaire de ${name} est le ${rec.date} 🎂`;
        }
      }

      await this.twitchApi.sendChatMessage(msg);
    } catch (error) {
      console.log(chalk.red(`❌ Erreur gestion !anniv: ${error.message}`));
      try {
        await this.twitchApi.sendChatMessage(`/me Désolé @${username}, une erreur est survenue lors de la récupération des anniversaires.`);
      } catch (err2) {
        console.log(chalk.red(`❌ Erreur envoi message !anniv erreur: ${err2.message}`));
      }
    }
  }

  /**
   * Gestion de la commande !monanniv (enregistrement)
   */
  async handleAnnivCommand(username, displayName, args) {
    const loginKey = username.toLowerCase();
    const trimmed = (args || '').trim();

    // Si pas d'arguments: rappeler la méthode d'enregistrement ou afficher la date existante
    if (!trimmed) {
      try {
        const existing = await this.birthdayManager.getBirthday(loginKey);
        if (existing) {
          const msg = `/me @${username} ta date d'anniversaire enregistrée est ${existing.date}`;
          await this.twitchApi.sendChatMessage(msg);
        } else {
          const helpMsg = `/me @${username} tu n'as pas encore enregistré ta date d'anniversaire. Utilise : !monanniv JJ/MM/AAAA (ex: !monanniv 19/04/2001).`;
          await this.twitchApi.sendChatMessage(helpMsg);
        }
      } catch (error) {
        console.log(chalk.red(`❌ Erreur gestion !monanniv (sans arguments): ${error.message}`));
      }
      return;
    }

    // Vérifier si déjà enregistré
    const existing = await this.birthdayManager.getBirthday(loginKey);
    if (existing) {
      const errMsg = `/me @${username} tu as déjà enregistré ta date d'anniversaire (${existing.date})`;
      try {
        await this.twitchApi.sendChatMessage(errMsg);
      } catch (error) {
        console.log(chalk.red(`❌ Erreur envoi message !anniv déjà défini: ${error.message}`));
      }
      return;
    }

    // Validation basique du format JJ/MM/AAAA
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
    if (!match) {
      const invalidMsg = `/me @${username} format invalide. Utilise JJ/MM/AAAA, par exemple 19/04/2001.`;
      try {
        await this.twitchApi.sendChatMessage(invalidMsg);
      } catch (error) {
        console.log(chalk.red(`❌ Erreur envoi message !anniv format: ${error.message}`));
      }
      return;
    }

    // Optionnel: vérification de date réelle
    const [_, dd, mm, yyyy] = match;
    const day = parseInt(dd, 10);
    const month = parseInt(mm, 10) - 1;
    const year = parseInt(yyyy, 10);
    const d = new Date(year, month, day);
    if (
      d.getFullYear() !== year ||
      d.getMonth() !== month ||
      d.getDate() !== day
    ) {
      const invalidDateMsg = `/me @${username} la date saisie n'est pas valide. Vérifie le jour, le mois et l'année.`;
      try {
        await this.twitchApi.sendChatMessage(invalidDateMsg);
      } catch (error) {
        console.log(chalk.red(`❌ Erreur envoi message !anniv date invalide: ${error.message}`));
      }
      return;
    }

    // Sauvegarder l'anniversaire
    try {
      await this.birthdayManager.setBirthday(loginKey, {
        username,
        displayName,
        date: trimmed
      });
      const okMsg = `/me Merci @${username}, ta date d'anniversaire (${trimmed}) a été enregistrée !`;
      await this.twitchApi.sendChatMessage(okMsg);
      console.log(chalk.blue(`🎂 Anniversaire enregistré pour ${username}: ${trimmed}`));
    } catch (error) {
      console.log(chalk.red(`❌ Erreur enregistrement anniversaire: ${error.message}`));
      try {
        await this.twitchApi.sendChatMessage(`/me Désolé @${username}, une erreur est survenue lors de l'enregistrement de ta date d'anniversaire.`);
      } catch (err2) {
        console.log(chalk.red(`❌ Erreur envoi message !anniv erreur: ${err2.message}`));
      }
    }
  }

  /**
   * Récupère l'ID utilisateur à partir du nom d'utilisateur
   */
  async getUserIdByUsername(username) {
    try {
      const response = await this.twitchApi.getUserByUsername(username);
      return response?.data?.[0]?.id;
    } catch (error) {
      console.error(`❌ Erreur lors de la récupération de l'ID utilisateur pour ${username}:`, error.message);
      return null;
    }
  }

  /**
   * Déconnecte le client
   */
  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      console.log(chalk.yellow('💬 Déconnecté du chat'));
    }
  }
}

export default ChatManager;
