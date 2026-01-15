import tmi from 'tmi.js';
import chalk from 'chalk';

class ChatManager {
  constructor(commandManager, twitchApi, channelName, sondageManager = null) {
    this.commandManager = commandManager;
    this.twitchApi = twitchApi;
    this.channelName = channelName;
    this.sondageManager = sondageManager;
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
    const isModerator = this.moderators.has(username.toLowerCase()) || tags.mod;
    const isBroadcaster = tags.badges && tags.badges.broadcaster;

    // Vérifier si c'est une commande (commence par !)
    if (message.startsWith('!')) {
      const parts = message.split(' ');
      const commandName = parts[0].substring(1); // Enlever le !
      const args = parts.slice(1).join(' '); // Arguments restants
      console.log(chalk.gray(`🔍 Commande détectée: !${commandName} par ${username} (mod: ${isModerator || isBroadcaster})`));
      
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
            if (this.sondageManager) {
              try {
                await this.sondageManager.setCurrentShoutout(targetUsername);
                
                  // Programmer l'effacement du shoutout après 1 minute
                  setTimeout(async () => {
                    try {
                      await this.sondageManager.clearCurrentShoutout();
                    } catch (err) {
                      console.log(chalk.gray('⚠️  Impossible d\'effacer automatiquement le shoutout'));
                    }
                  }, 60 * 1000); // 1 minute
                
                console.log(chalk.blue(`💬 Shoutout défini dans l'API duc-engine: ${targetUsername}`));
              } catch (error) {
                console.log(chalk.red(`❌ Erreur définition shoutout API: ${error.message}`));
              }
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
              // Générer automatiquement la liste des commandes globales
              const globalCommands = this.commandManager.commands.global || {};
              const commandNames = Object.keys(globalCommands)
                .filter(cmd => cmd.toLowerCase() !== 'list' && cmd.toLowerCase() !== 'liste') // Exclure les commandes list et liste
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
