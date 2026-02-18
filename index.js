#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import TwitchAuth from './src/auth/twitchAuth.js';
import { AuthServer } from './src/auth/authServer.js';
import TwitchApi from './src/twitch/twitchApi.js';
import CommandManager from './src/chat/commandManager.js';
import ChatManager from './src/chat/chatManager.js';
import ApiServer from './src/api/server.js';
import { config } from './config.js';
import fs from 'fs/promises';
import path from 'path';

const program = new Command();

// Instances globales
let twitchAuth = new TwitchAuth();
let twitchApi = new TwitchApi(twitchAuth);
let commandManager = new CommandManager();
let chatManager = null;

// Configuration du CLI
program
  .name('duc-api')
  .description('CLI API pour interagir avec Twitch (auth, rewards, commandes de chat, API)')
  .version('1.0.0');

/**
 * Commande engine: surveille les rewards et lance des actions automatiques (sans sondages / wheel / questions)
 */
program
  .command('engine')
  .description('Surveille les rewards et lance des actions automatiques (sans sondages / wheel / questions)')
  .option('-r, --reward <rewardId>', 'ID du reward de sondage à surveiller (non utilisé)', '09797286-a2b9-4227-be52-b9a323f46755')
  .option('-a, --announcementReward <id>', 'ID du reward d\'annonce à surveiller', '64c56f9e-86ba-4ce9-b866-4fe8deaf7911')
  .option('-i, --interval <ms>', 'Intervalle de polling en millisecondes', '500')
  .option('-c, --chat', 'Activer la connexion au chat Twitch pour les commandes', true)
  .action(async (options) => {
    try {
      // Auth
      if (!twitchAuth.isAuthenticated()) {
        const hasValidTokens = await twitchAuth.initialize();
        if (!hasValidTokens) {
          console.log(chalk.yellow('⚠️  Authentification requise'));
          const success = await authenticateWithTwitch();
          if (!success) {
            console.log(chalk.red('❌ Impossible de continuer sans authentification'));
            return;
          }
        }
      }

      // Charger commandes si le chat est activé (activé par défaut)
      if (options.chat !== false) {
        // Vérifier que nous avons le username pour le chat
        if (!twitchAuth.username) {
          console.log(chalk.yellow('⚠️  Username manquant, récupération des informations utilisateur...'));
          await twitchAuth.getUserInfo();
        }

        await commandManager.loadCommands();
        
        // Initialiser le chat manager (sans gestion de sondages)
        const channelName = 'duclems'; // Nom de la chaîne
        chatManager = new ChatManager(commandManager, twitchApi, channelName);
        
        try {
          await chatManager.initialize();
        } catch (err) {
          console.log(chalk.yellow('⚠️  Impossible de se connecter au chat:', err.message));
          options.chat = false; // Désactiver le chat si la connexion échoue
        }
      }

      // Fichier d'état pour éviter les doublons
      const stateFile = path.join(process.cwd(), '.engine-state.json');
      let processedIds = new Set();
      try {
        const raw = await fs.readFile(stateFile, 'utf8');
        const json = JSON.parse(raw);
        processedIds = new Set(json.processed || []);
      } catch {}

      const saveState = async () => {
        await fs.writeFile(stateFile, JSON.stringify({ processed: Array.from(processedIds) }, null, 2));
      };

      // Déclarer le serveur API au niveau de la fonction
      let apiServer = null;

      console.log(chalk.blue(`🚀 Engine démarré. Rewards surveillés (sans sondages / wheel / questions):`));
      console.log(chalk.blue(`   📢 Annonces: ${options.announcementReward}`));
      console.log(chalk.blue(`   ⏱️  Intervalle: ${options.interval}ms`));
      if (options.chat) {
        console.log(chalk.blue(`   💬 Chat: Activé (commandes bots)`));
      }

      // Démarrer le serveur API en même temps
      apiServer = new ApiServer();
      await apiServer.start();
      console.log(chalk.green(`🌐 Serveur API démarré sur le port 3002`));

      // Curseurs de pagination pour les rewards surveillés
      let pollCursor = null;
      let announcementCursor = null;

      // Timer pour l'annonce automatique des commandes toutes les 30 minutes
      const sendCommandsAnnouncement = async () => {
        try {
          const message = 'Pour savoir la liste des commandes : !list';
          await twitchApi.sendAnnouncement(message, 'purple');
          console.log(chalk.blue(`📢 Annonce automatique des commandes envoyée`));
        } catch (err) {
          console.log(chalk.red('❌ Erreur lors de l\'envoi de l\'annonce automatique:'), err.response?.data || err.message);
        }
      };

      // Programmer l'annonce automatique toutes les 30 minutes
      setInterval(sendCommandsAnnouncement, 30 * 60 * 1000); // 30 minutes
      console.log(chalk.blue(`⏰ Annonce automatique des commandes programmée toutes les 30 minutes`));
      
      const loop = async () => {
        try {
          // Recharger les commandes si nécessaire
          const commandsReloaded = options.chat ? await commandManager.checkAndReloadIfNeeded() : false;
          if (commandsReloaded) {
            console.log(chalk.blue('🔄 Commandes du bot rechargées'));
          }

          // Surveiller uniquement le reward d'annonces
          const announcementData = await twitchApi.getRewardRedemptions(options.announcementReward, 'UNFULFILLED', announcementCursor);

          const announcementRedemptions = announcementData.data || [];
          announcementCursor = announcementData.pagination?.cursor || null;

          // Traiter les redemptions d'annonces
          for (const r of announcementRedemptions) {
            if (processedIds.has(r.id)) continue;
            processedIds.add(r.id);
            await saveState();
            console.log(chalk.green(`🎁 Redemption annonce détectée: ${r.id} par ${r.user_input || r.user_name || 'utilisateur'}`));

            console.log(chalk.yellow('⚠️  Aucune logique d\'annonce automatique configurée pour ce reward.'));
          }
        } catch (err) {
          console.log(chalk.red('❌ Erreur engine:'), err.response?.data || err.message);
        } finally {
          setTimeout(loop, parseInt(options.interval));
        }
      };

      // Gestion de la déconnexion propre
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n🛑 Arrêt de l\'engine...'));
        if (chatManager) {
          await chatManager.disconnect();
        }
        if (apiServer) {
          await apiServer.stop();
        }
        process.exit(0);
      });

      loop();
    } catch (error) {
      console.error(chalk.red('❌ Erreur:'), error.message);
    }
  });

/**
 * Authentification avec Twitch
 */
async function authenticateWithTwitch() {
  console.log(chalk.blue('🔐 Authentification avec Twitch...'));
  
  const authServer = new AuthServer(config.port);
  
  try {
    // Démarrer le serveur d'authentification
    await authServer.start();
    
    // Ouvrir le navigateur pour l'authentification
    const browserOpened = await twitchAuth.openAuthBrowser();
    if (!browserOpened) {
      throw new Error('Impossible d\'ouvrir le navigateur');
    }
    
    console.log(chalk.yellow('⏳ En attente de l\'authentification...'));
    
    // Attendre le code d'autorisation
    const authCode = await authServer.waitForAuth();
    
    // Échanger le code contre un token
    const success = await twitchAuth.exchangeCodeForToken(authCode);
    
    if (success) {
      console.log(chalk.green('✅ Authentification réussie!'));
      return true;
    } else {
      throw new Error('Échec de l\'échange du code d\'autorisation');
    }
  } catch (error) {
    console.error(chalk.red('❌ Erreur d\'authentification:'), error.message);
    return false;
  } finally {
    authServer.stop();
  }
}


/**
 * Commande pour gérer les commandes bots
 */
program
  .command('commands')
  .description('Gérer les commandes bots du chat')
  .option('-l, --list', 'Lister toutes les commandes')
  .option('-a, --add', 'Ajouter une nouvelle commande')
  .option('-r, --remove <name>', 'Supprimer une commande')
  .action(async (options) => {
    try {
      await commandManager.loadCommands();
      
      if (options.list) {
        commandManager.displayCommands();
      } else if (options.add) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'commandName',
            message: 'Nom de la commande (sans le !):',
            validate: (input) => input.trim() !== '' || 'Le nom de la commande ne peut pas être vide'
          },
          {
            type: 'input',
            name: 'response',
            message: 'Réponse de la commande:',
            validate: (input) => input.trim() !== '' || 'La réponse ne peut pas être vide'
          },
          {
            type: 'input',
            name: 'description',
            message: 'Description de la commande (optionnel):'
          },
          {
            type: 'list',
            name: 'type',
            message: 'Type de commande:',
            choices: [
              { name: 'Globale (tous les utilisateurs)', value: 'global' },
              { name: 'Modérateur (mods uniquement)', value: 'moderator' }
            ]
          }
        ]);
        
        await commandManager.addCommand(
          answers.commandName, 
          answers.response, 
          answers.description, 
          answers.type === 'moderator'
        );
      } else if (options.remove) {
        const answers = await inquirer.prompt([
          {
            type: 'list',
            name: 'type',
            message: 'Type de commande à supprimer:',
            choices: [
              { name: 'Globale', value: 'global' },
              { name: 'Modérateur', value: 'moderator' }
            ]
          }
        ]);
        
        const removed = await commandManager.removeCommand(options.remove, answers.type === 'moderator');
        if (!removed) {
          console.log(chalk.red(`❌ Commande !${options.remove} non trouvée`));
        }
      } else {
        commandManager.displayCommands();
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Erreur:'), error.message);
    }
  });

/**
 * Commande pour créer un reward de points de chaîne
 */
program
  .command('create-reward')
  .description('Créer un nouveau reward de points de chaîne')
  .option('-n, --rewardname <name>', 'Nom du reward à créer')
  .option('-c, --cost <points>', 'Coût en points du reward', '100')
  .option('-d, --description <text>', 'Description du reward', '')
  .option('-b, --background-color <color>', 'Couleur de fond (hex)', '#9146FF')
  .option('-e, --enabled', 'Activer le reward immédiatement', false)
  .action(async (options) => {
    try {
      // Vérifier l'authentification
      if (!twitchAuth.isAuthenticated()) {
        const hasValidTokens = await twitchAuth.initialize();
        if (!hasValidTokens) {
          console.log(chalk.red('❌ Non authentifié avec Twitch. Utilisez: npm run auth -- --login'));
          return;
        }
      }

      if (!options.rewardname) {
        console.log(chalk.red('❌ Le nom du reward est requis. Utilisez: --rewardname "Mon Reward"'));
        return;
      }

      const cost = parseInt(options.cost);
      if (isNaN(cost) || cost < 1) {
        console.log(chalk.red('❌ Le coût doit être un nombre positif'));
        return;
      }

      console.log(chalk.blue(`🎁 Création du reward: "${options.rewardname}" (${cost} points)`));

      const reward = await twitchApi.createChannelReward({
        title: options.rewardname,
        cost: cost,
        prompt: options.description || '',
        background_color: options.backgroundColor,
        is_enabled: options.enabled
      });

      console.log(chalk.green(`✅ Reward créé avec succès!`));
      console.log(chalk.blue(`   🆔 ID: ${reward.id}`));
      console.log(chalk.blue(`   📝 Titre: ${reward.title}`));
      console.log(chalk.blue(`   💰 Coût: ${reward.cost} points`));
      console.log(chalk.blue(`   ✅ Actif: ${reward.is_enabled ? 'Oui' : 'Non'}`));
      console.log(chalk.blue(`   🎨 Couleur: ${reward.background_color}`));
      
    } catch (error) {
      console.error(chalk.red('❌ Erreur lors de la création du reward:'), error.response?.data || error.message);
    }
  });

/**
 * Commande pour l'authentification
 */
program
  .command('auth')
  .description('Gérer l\'authentification Twitch')
  .option('-l, --login', 'Se connecter à Twitch')
  .option('-o, --logout', 'Se déconnecter de Twitch')
  .option('-s, --status', 'Vérifier le statut de connexion')
  .action(async (options) => {
    if (options.login) {
      const success = await authenticateWithTwitch();
      if (success) {
        console.log(chalk.green('✅ Connexion réussie!'));
      } else {
        console.log(chalk.red('❌ Échec de la connexion'));
      }
    } else if (options.logout) {
      await twitchAuth.logout();
    } else if (options.status) {
      // Essayer de charger les tokens sauvegardés
      const hasValidTokens = await twitchAuth.initialize();
      if (hasValidTokens) {
        console.log(chalk.green('✅ Connecté à Twitch'));
        const userInfo = await twitchAuth.getUserInfo();
        if (userInfo) {
          console.log(`👤 Utilisateur: ${userInfo.display_name}`);
        }
      } else {
        console.log(chalk.red('❌ Non connecté à Twitch'));
      }
    } else {
      console.log(chalk.yellow('Utilisez --help pour voir les options disponibles'));
    }
  });

/**
 * Commande pour les rewards de points du canal
 */
program
  .command('rewards')
  .description('Gérer les rewards de points du canal')
  .option('-l, --list', 'Lister tous les rewards')
  .action(async (options) => {
    try {
      if (!twitchAuth.isAuthenticated()) {
        // Essayer de charger les tokens sauvegardés
        const hasValidTokens = await twitchAuth.initialize();
        if (!hasValidTokens) {
          console.log(chalk.red('❌ Authentification requise'));
          return;
        }
      }
      
      if (options.list) {
        const rewards = await twitchApi.getChannelRewards();
        if (rewards.length === 0) {
          console.log(chalk.yellow('🎁 Aucun reward configuré'));
        } else {
          console.log(chalk.blue('🎁 Rewards de points du canal:'));
          rewards.forEach(reward => {
            console.log(`   🆔 ID: ${reward.id}`);
            console.log(`   📝 Titre: ${reward.title}`);
            console.log(`   💰 Coût: ${reward.cost} points`);
            console.log(`   ✅ Actif: ${reward.is_enabled ? 'Oui' : 'Non'}`);
            console.log(`   🔄 En pause: ${reward.is_paused ? 'Oui' : 'Non'}`);
            if (reward.description) {
              console.log(`   📄 Description: ${reward.description}`);
            }
            if (reward.background_color) {
              console.log(`   🎨 Couleur: ${reward.background_color}`);
            }
            console.log('');
          });
        }
      } else {
        console.log(chalk.yellow('Utilisez --list pour voir les rewards'));
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Erreur:'), error.message);
    }
  });

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('❌ Erreur non gérée:'), reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ Exception non capturée:'), error);
  process.exit(1);
});

// Affichage de l'aide personnalisée si aucune commande n'est fournie ou si c'est la commande help
if (process.argv.length <= 2 || (process.argv.length === 3 && process.argv[2] === 'help')) {
  // Afficher notre aide personnalisée au lieu de l'aide par défaut
  console.log('\n' + '='.repeat(80));
  console.log('                    DUC-API - GUIDE COMPLET DES COMMANDES');
  console.log('='.repeat(80));
  
  console.log('\n🔐 AUTHENTIFICATION:');
  console.log('  npm run auth -- --login                    Se connecter à Twitch');
  console.log('  npm run auth -- --status                   Afficher le statut de connexion');
  console.log('  npm run auth -- --logout                   Se déconnecter');
  
  console.log('\n📊 SONDAGES / POLLS:');
  console.log('  Les anciennes commandes de sondages/polls basées sur des fichiers JSON sont désactivées.');
  
  console.log('\n🎁 REWARDS (Channel Points):');
  console.log('  npm run rewards -- --list                  Lister tous les rewards de points');
  console.log('  npm run create-reward -- --rewardname "<name>" --cost <points>');
  console.log('    --description "<desc>" --background-color <color> --enabled <true/false>');
  console.log('    Créer un nouveau reward personnalisé');
  
  console.log('\n🤖 COMMANDES BOTS:');
  console.log('  npm run commands -- --list                 Lister toutes les commandes');
  console.log('  npm run commands -- --add                  Ajouter une nouvelle commande');
  console.log('  npm run commands -- --remove <command_name>  Supprimer une commande');
  
  console.log('\n⚙️  ENGINE (Surveillance automatique):');
  console.log('  npm run engine                             Surveille les rewards et lance des actions (sans sondages / wheel / questions)');
  console.log('  npm run engine -- --reward <reward_id>     (Paramètre conservé pour compatibilité, non utilisé)');
  console.log('  npm run engine -- --announcementReward <id>  Spécifier un autre reward d\'annonce');
  console.log('  npm run engine -- --interval <ms>          Intervalle de polling (défaut: 500ms)');
  
  console.log('\n🌐 API (Serveur HTTP):');
  console.log('  npm run api                                Démarre le serveur API pour exposer les annonces');
  console.log('  npm run api -- --port <port>               Spécifier un port personnalisé (défaut: 3002)');
  
  console.log('\n📝 EXEMPLES D\'UTILISATION:');
  console.log('  # Créer un reward personnalisé:');
  console.log('  npm run create-reward -- --rewardname "Poll Gratuit" --cost 100 --description "Lance un sondage"');
  console.log('');
  console.log('  # Lancer l\'engine avec intervalle personnalisé:');
  console.log('  npm run engine -- --interval 1000');
  console.log('');
  console.log('  # Créer un poll avec durée personnalisée:');
  console.log('  npm run poll -- --duration 120');
  console.log('');
  console.log('  # Ajouter une commande bot:');
  console.log('  npm run commands -- --add');
  
  console.log('\n🎯 COMMANDES CHAT DISPONIBLES:');
  console.log('  !list                                     Affiche toutes les commandes disponibles');
  console.log('  !of                                       Lien OnlyFans');
  console.log('  !planning                                 Planning des streams');
  console.log('  !youtube                                  Chaine YouTube');
  console.log('  !tiktok                                   Chaine TikTok');
  console.log('  !discord                                  Serveur Discord');
  console.log('  !lurk                                     Message de remerciement aléatoire');
  
  console.log('\n📁 FICHIERS DE CONFIGURATION:');
  console.log('  (Ancien) files/sondage.json              SUPPRIMÉ - Anciennes questions pour les polls');
  console.log('  (Ancien) files/questions.json            SUPPRIMÉ - Anciennes questions pour les annonces');
  console.log('  files/commands.json                       Commandes du bot chat');
  console.log('  .env                                      Variables d\'environnement');
  console.log('  .twitch-tokens.json                       Tokens d\'authentification');
  
  console.log('\n🔧 ALTERNATIVES:');
  console.log('  node index.js <commande> [options]        Utilisation directe sans npm run');
  console.log('  npm start <commande> [options]            Utilisation avec npm start');
  
  console.log('\n' + '='.repeat(80));
  console.log('💡 ASTUCE: Utilisez --help après une commande pour plus de détails');
  console.log('='.repeat(80) + '\n');
  
  process.exit(0);
}

// Remplacer l'aide par défaut
program.configureHelp({
  helpWidth: 120,
  sortSubcommands: true
});

/**
 * Commande API: démarre le serveur API pour exposer les annonces
 */
program
  .command('api')
  .description('Démarre le serveur API pour exposer les annonces et questions')
  .option('-p, --port <port>', 'Port du serveur API', 3002)
  .action(async (options) => {
    try {
      console.log(chalk.blue('🚀 Démarrage du serveur API Duc Engine...'));
      
      const apiServer = new ApiServer();
      await apiServer.start();
      
      console.log(chalk.green('✅ Serveur API démarré avec succès!'));
      console.log(chalk.yellow('📡 Endpoints disponibles:'));
      console.log(chalk.cyan('   - GET /health - Vérification de santé'));
      console.log(chalk.cyan('   - GET /api/announcements - Annonces disponibles'));
      console.log(chalk.cyan('   - GET /api/announcements/questions - Toutes les questions'));
      console.log(chalk.cyan('   - GET /api/announcements/questions/:questionId - Question spécifique'));
      console.log(chalk.cyan('   - GET /api/announcements/random - Question aléatoire'));
      console.log(chalk.cyan('   - GET /api/announcements/current - Question d\'annonce en cours'));
      console.log(chalk.cyan('   - GET /api/twitch/channel/:userId - Informations d\'un canal Twitch'));
      console.log(chalk.yellow('\n💡 Utilisez Ctrl+C pour arrêter le serveur'));
      
    } catch (error) {
      console.error(chalk.red('❌ Erreur lors du démarrage du serveur API:'), error.message);
      process.exit(1);
    }
  });

// Parse des arguments
program.parse();

// Commande d'aide personnalisée
program
  .command('help')
  .description('Afficher la liste complète des commandes et options')
  .option('--help', 'Afficher l\'aide détaillée')
  .action((options) => {
    console.log('\n' + '='.repeat(80));
    console.log('                    DUC-API - GUIDE COMPLET DES COMMANDES');
    console.log('='.repeat(80));
    
    console.log('\n🔐 AUTHENTIFICATION:');
    console.log('  npm run auth -- --login                    Se connecter à Twitch');
    console.log('  npm run auth -- --status                   Afficher le statut de connexion');
    console.log('  npm run auth -- --logout                   Se déconnecter');
    
    console.log('\n📊 SONDAGES / POLLS:');
    console.log('  Les anciennes commandes de sondages/polls basées sur des fichiers JSON sont désactivées.');
    
    console.log('\n🎁 REWARDS (Channel Points):');
    console.log('  npm run rewards -- --list                  Lister tous les rewards de points');
    console.log('  npm run create-reward -- --rewardname "<name>" --cost <points>');
    console.log('    --description "<desc>" --background-color <color> --enabled <true/false>');
    console.log('    Créer un nouveau reward personnalisé');
    
    console.log('\n🤖 COMMANDES BOTS:');
    console.log('  npm run commands -- --list                 Lister toutes les commandes');
    console.log('  npm run commands -- --add                  Ajouter une nouvelle commande');
    console.log('  npm run commands -- --remove <command_name>  Supprimer une commande');
    
    console.log('\n⚙️  ENGINE (Surveillance automatique):');
    console.log('  npm run engine                             Surveille les rewards et lance des actions (sans sondages / wheel / questions)');
    console.log('  npm run engine -- --reward <reward_id>     (Paramètre conservé pour compatibilité, non utilisé)');
    console.log('  npm run engine -- --announcementReward <id>  Spécifier un autre reward d\'annonce');
    console.log('  npm run engine -- --interval <ms>          Intervalle de polling (défaut: 500ms)');
    
    console.log('\n🌐 API (Serveur HTTP):');
    console.log('  npm run api                                Démarre le serveur API pour exposer les annonces');
    console.log('  npm run api -- --port <port>               Spécifier un port personnalisé (défaut: 3002)');
    
    console.log('\n📝 EXEMPLES D\'UTILISATION:');
    console.log('  # Créer un reward personnalisé:');
    console.log('  npm run create-reward -- --rewardname "Poll Gratuit" --cost 100 --description "Lance un sondage"');
    console.log('');
    console.log('  # Lancer l\'engine avec intervalle personnalisé:');
    console.log('  npm run engine -- --interval 1000');
    console.log('');
    console.log('  # Créer un poll avec durée personnalisée:');
    console.log('  npm run poll -- --duration 120');
    console.log('');
    console.log('  # Ajouter une commande bot:');
    console.log('  npm run commands -- --add');
    
    console.log('\n🎯 COMMANDES CHAT DISPONIBLES:');
    console.log('  !list                                     Affiche toutes les commandes disponibles');
    console.log('  !of                                       Lien OnlyFans');
    console.log('  !planning                                 Planning des streams');
    console.log('  !youtube                                  Chaine YouTube');
    console.log('  !tiktok                                   Chaine TikTok');
    console.log('  !discord                                  Serveur Discord');
    console.log('  !lurk                                     Message de remerciement aléatoire');
    
    console.log('\n📁 FICHIERS DE CONFIGURATION:');
    console.log('  (Ancien) files/sondage.json              SUPPRIMÉ - Anciennes questions pour les polls');
    console.log('  (Ancien) files/questions.json            SUPPRIMÉ - Anciennes questions pour les annonces');
    console.log('  files/commands.json                       Commandes du bot chat');
    console.log('  .env                                      Variables d\'environnement');
    console.log('  .twitch-tokens.json                       Tokens d\'authentification');
    
    console.log('\n🔧 ALTERNATIVES:');
    console.log('  node index.js <commande> [options]        Utilisation directe sans npm run');
    console.log('  npm start <commande> [options]            Utilisation avec npm start');
    
    console.log('\n' + '='.repeat(80));
    console.log('💡 ASTUCE: Utilisez --help après une commande pour plus de détails');
    console.log('='.repeat(80) + '\n');
  });
