#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import TwitchAuth from './src/auth/twitchAuth.js';
import { AuthServer } from './src/auth/authServer.js';
import SondageManager from './src/sondages/sondageManager.js';
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
let sondageManager = new SondageManager();
let twitchApi = new TwitchApi(twitchAuth);
let commandManager = new CommandManager();
let chatManager = null;

// Configuration du CLI
program
  .name('duc-api')
  .description('CLI API pour créer des polls Twitch avec gestion des sondages')
  .version('1.0.0');

/**
 * Commande engine: surveille un reward et lance un poll aléatoire
 */
program
  .command('engine')
  .description('Surveille les rewards et lance des actions automatiques')
  .option('-r, --reward <rewardId>', 'ID du reward de sondage à surveiller', '09797286-a2b9-4227-be52-b9a323f46755')
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

      // Charger sondages
      await sondageManager.loadSondages();

      // Charger commandes si le chat est activé (activé par défaut)
      if (options.chat !== false) {
        // Vérifier que nous avons le username pour le chat
        if (!twitchAuth.username) {
          console.log(chalk.yellow('⚠️  Username manquant, récupération des informations utilisateur...'));
          await twitchAuth.getUserInfo();
        }

        await commandManager.loadCommands();
        
        // Initialiser le chat manager
        const channelName = 'duclems'; // Nom de la chaîne
        chatManager = new ChatManager(commandManager, twitchApi, channelName, sondageManager);
        
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

      console.log(chalk.blue(`🚀 Engine démarré. Rewards surveillés:`));
      console.log(chalk.blue(`   📊 Sondages: ${options.reward}`));
      console.log(chalk.blue(`   📢 Annonces: ${options.announcementReward}`));
      console.log(chalk.blue(`   ⏱️  Intervalle: ${options.interval}ms`));
      if (options.chat) {
        console.log(chalk.blue(`   💬 Chat: Activé (commandes bots)`));
      }

      // Démarrer le serveur API en même temps
      apiServer = new ApiServer();
      await apiServer.start();
      console.log(chalk.green(`🌐 Serveur API démarré sur le port 3002`));

      // Vérification initiale des sondages et questions disponibles
      const initialAvailable = sondageManager.getAvailableSondages();
      const initialQuestions = await sondageManager.getAvailableAnnouncementQuestions();
      console.log(chalk.blue(`📋 Sondages disponibles au démarrage: ${initialAvailable.length}`));
      console.log(chalk.blue(`📋 Questions disponibles au démarrage: ${initialQuestions.length}`));
      
      let pollCursor = null;
      let announcementCursor = null;
      
      // Configurer la limite de redemptions au démarrage pour les sondages
      try {
        await twitchApi.updateRewardRedemptionLimit(options.reward, initialAvailable.length);
        if (initialAvailable.length > 1) {
          console.log(chalk.green(`✅ Limite de redemptions sondages configurée au démarrage: ${initialAvailable.length}`));
          // Cooldown de base de 15 minutes si plus d'1 sondage disponible
          await twitchApi.updateRewardCooldown(options.reward, 900);
          console.log(chalk.blue(`⏰ Cooldown de base de 15 minutes activé pour les sondages`));
        } else if (initialAvailable.length === 1) {
          console.log(chalk.yellow(`⚠️  Il ne reste qu'1 sondage - Cooldown de 1 jour activé`));
          // Activer un cooldown de 1 jour si il ne reste qu'1 sondage
          await twitchApi.updateRewardCooldown(options.reward, 86400);
        } else {
          console.log(chalk.yellow('⚠️  Aucun sondage disponible - Cooldown de 1 jour activé'));
          // Activer un cooldown de 1 jour si aucun sondage disponible
          await twitchApi.updateRewardCooldown(options.reward, 86400);
        }
      } catch (err) {
        console.log(chalk.red('❌ Erreur lors de la configuration initiale de la limite sondages:'), err.response?.data || err.message);
      }

      // Configurer la limite de redemptions au démarrage pour les annonces
      try {
        await twitchApi.updateRewardRedemptionLimit(options.announcementReward, initialQuestions.length);
        if (initialQuestions.length > 1) {
          console.log(chalk.green(`✅ Limite de redemptions annonces configurée au démarrage: ${initialQuestions.length}`));
          // Cooldown de base de 5 minutes si plus d'1 question disponible
          await twitchApi.updateRewardCooldown(options.announcementReward, 300);
          console.log(chalk.blue(`⏰ Cooldown de base de 5 minutes activé pour les annonces`));
        } else if (initialQuestions.length === 1) {
          console.log(chalk.yellow(`⚠️  Il ne reste qu'1 question - Cooldown de 1 jour activé`));
          // Activer un cooldown de 1 jour si il ne reste qu'1 question
          await twitchApi.updateRewardCooldown(options.announcementReward, 86400);
        } else {
          console.log(chalk.yellow('⚠️  Aucune question disponible - Cooldown de 1 jour activé'));
          // Activer un cooldown de 1 jour si aucune question disponible
          await twitchApi.updateRewardCooldown(options.announcementReward, 86400);
        }
      } catch (err) {
        console.log(chalk.red('❌ Erreur lors de la configuration initiale de la limite annonces:'), err.response?.data || err.message);
      }

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
          // Vérifier si les fichiers ont été modifiés
          const sondagesReloaded = await sondageManager.checkAndReloadIfNeeded(true);
          const questionsReloaded = await sondageManager.checkAnnouncementQuestionsFileModified();
          const commandsReloaded = options.chat ? await commandManager.checkAndReloadIfNeeded() : false;
          
          // Mettre à jour les limites si un fichier a été modifié
          if (sondagesReloaded || questionsReloaded || commandsReloaded) {
            const available = sondageManager.getAvailableSondages();
            const questions = await sondageManager.getAvailableAnnouncementQuestions();
            
            // Mettre à jour la limite des sondages si le fichier sondage.json a été modifié
            if (sondagesReloaded) {
              try {
                await twitchApi.updateRewardRedemptionLimit(options.reward, available.length);
                if (available.length > 1) {
                  console.log(chalk.blue(`🔄 Limite de redemptions sondages mise à jour: ${available.length}`));
                  // Cooldown de base de 15 minutes si plus d'1 sondage disponible
                  await twitchApi.updateRewardCooldown(options.reward, 900);
                  console.log(chalk.blue(`⏰ Cooldown de base de 15 minutes activé pour les sondages`));
                } else if (available.length === 1) {
                  console.log(chalk.yellow(`🔄 Il ne reste qu'1 sondage - Cooldown de 1 jour activé`));
                  // Activer un cooldown de 1 jour si il ne reste qu'1 sondage
                  await twitchApi.updateRewardCooldown(options.reward, 86400);
                } else {
                  console.log(chalk.yellow('🔄 Limite de redemptions sondages désactivée (aucun sondage disponible) - Cooldown de 1 jour activé'));
                  // Activer un cooldown de 1 jour si aucun sondage disponible
                  await twitchApi.updateRewardCooldown(options.reward, 86400);
                }
              } catch (err) {
                console.log(chalk.red('❌ Erreur lors de la mise à jour de la limite sondages:'), err.response?.data || err.message);
              }
            }

            // Mettre à jour la limite des annonces si le fichier questions.json a été modifié
            if (questionsReloaded) {
              try {
                await twitchApi.updateRewardRedemptionLimit(options.announcementReward, questions.length);
                if (questions.length > 1) {
                  console.log(chalk.blue(`🔄 Limite de redemptions annonces mise à jour: ${questions.length}`));
                  // Cooldown de base de 5 minutes si plus d'1 question disponible
                  await twitchApi.updateRewardCooldown(options.announcementReward, 300);
                  console.log(chalk.blue(`⏰ Cooldown de base de 5 minutes activé pour les annonces`));
                } else if (questions.length === 1) {
                  console.log(chalk.yellow(`🔄 Il ne reste qu'1 question - Cooldown de 1 jour activé`));
                  // Activer un cooldown de 1 jour si il ne reste qu'1 question
                  await twitchApi.updateRewardCooldown(options.announcementReward, 86400);
                } else {
                  console.log(chalk.yellow('🔄 Limite de redemptions annonces désactivée (aucune question disponible) - Cooldown de 1 jour activé'));
                  // Activer un cooldown de 1 jour si aucune question disponible
                  await twitchApi.updateRewardCooldown(options.announcementReward, 86400);
                }
              } catch (err) {
                console.log(chalk.red('❌ Erreur lors de la mise à jour de la limite annonces:'), err.response?.data || err.message);
              }
            }
          }

          // Surveiller les deux rewards en parallèle
          const [pollData, announcementData] = await Promise.all([
            twitchApi.getRewardRedemptions(options.reward, 'UNFULFILLED', pollCursor),
            twitchApi.getRewardRedemptions(options.announcementReward, 'UNFULFILLED', announcementCursor)
          ]);

          const pollRedemptions = pollData.data || [];
          const announcementRedemptions = announcementData.data || [];
          
          pollCursor = pollData.pagination?.cursor || null;
          announcementCursor = announcementData.pagination?.cursor || null;

          // Traiter les redemptions de sondages
          for (const r of pollRedemptions) {
            if (processedIds.has(r.id)) continue;
            processedIds.add(r.id);
            await saveState();
            console.log(chalk.green(`🎁 Redemption sondage détectée: ${r.id} par ${r.user_input || r.user_name || 'utilisateur'}`));

            // Choisir un sondage aléatoire dispo
            const availableNow = sondageManager.getAvailableSondages();
            if (availableNow.length === 0) {
              console.log(chalk.yellow('⚠️  Aucun sondage disponible pour créer un poll'));
              continue;
            }
            const pick = availableNow[Math.floor(Math.random() * availableNow.length)];
            // Créer le poll
            try {
              await twitchApi.createPollFromQuestion(pick, 60);
              const idx = sondageManager.sondages.findIndex(q => q === pick);
              await sondageManager.markSondageAsUsed(idx);
              
              // Afficher le nombre de sondages restants
              const remaining = sondageManager.getAvailableSondages().length;
              console.log(chalk.green(`✅ Poll lancé suite à la redemption (${remaining} sondages restants)`));
              
              // Mettre à jour le cooldown selon le nombre de sondages restants
              try {
                if (remaining > 1) {
                  await twitchApi.updateRewardCooldown(options.reward, 900);
                  console.log(chalk.blue(`⏰ Cooldown de base de 15 minutes activé pour les sondages (${remaining} restants)`));
                } else if (remaining === 1) {
                  await twitchApi.updateRewardCooldown(options.reward, 86400);
                  console.log(chalk.yellow('🔄 Il ne reste qu\'1 sondage - Cooldown de 1 jour activé'));
                } else {
                  await twitchApi.updateRewardCooldown(options.reward, 86400);
                  console.log(chalk.yellow('🔄 Aucun sondage restant - Cooldown de 1 jour activé'));
                }
              } catch (err) {
                console.log(chalk.red('❌ Erreur lors de l\'activation du cooldown:'), err.response?.data || err.message);
              }
            } catch (err) {
              console.log(chalk.red('❌ Échec de la création du poll:'), err.response?.data || err.message);
            }
          }

          // Traiter les redemptions d'annonces
          for (const r of announcementRedemptions) {
            if (processedIds.has(r.id)) continue;
            processedIds.add(r.id);
            await saveState();
            console.log(chalk.green(`🎁 Redemption annonce détectée: ${r.id} par ${r.user_input || r.user_name || 'utilisateur'}`));

            // Choisir une question aléatoire pour l'annonce
            try {
              const randomQuestion = await sondageManager.getRandomAnnouncementQuestion();
              if (!randomQuestion) {
                console.log(chalk.yellow('⚠️  Aucune question disponible pour l\'annonce'));
                continue;
              }

              // Définir la question comme question actuelle
              await sondageManager.setCurrentAnnouncementQuestion(randomQuestion.question);

              const message = `duclemRami ${randomQuestion.question}`;
              await twitchApi.sendAnnouncement(message, 'purple');
              console.log(chalk.green(`✅ Annonce épinglée: "${randomQuestion.question}"`));
              
              // Marquer la question comme utilisée
              await sondageManager.markAnnouncementQuestionAsUsed(randomQuestion.question);
              
              // Vérifier s'il reste des questions disponibles et mettre à jour le cooldown
              const remainingQuestions = await sondageManager.getAvailableAnnouncementQuestions();
              try {
                if (remainingQuestions.length > 1) {
                  await twitchApi.updateRewardCooldown(options.announcementReward, 300);
                  console.log(chalk.blue(`⏰ Cooldown de base de 5 minutes activé pour les annonces (${remainingQuestions.length} restantes)`));
                } else if (remainingQuestions.length === 1) {
                  await twitchApi.updateRewardCooldown(options.announcementReward, 86400);
                  console.log(chalk.yellow('🔄 Il ne reste qu\'1 question - Cooldown de 1 jour activé'));
                } else {
                  await twitchApi.updateRewardCooldown(options.announcementReward, 86400);
                  console.log(chalk.yellow('🔄 Aucune question restante - Cooldown de 1 jour activé'));
                }
              } catch (err) {
                console.log(chalk.red('❌ Erreur lors de l\'activation du cooldown:'), err.response?.data || err.message);
              }
              
              // Programmer la suppression de l'épinglage après 5 minutes
              setTimeout(async () => {
                try {
                  console.log(chalk.gray(`⏰ Annonce automatiquement désépinglée après 5 minutes`));
                  // Effacer la question actuelle
                  await sondageManager.clearCurrentAnnouncementQuestion();
                } catch (err) {
                  console.log(chalk.gray('⚠️  Impossible de désépingler automatiquement'));
                }
              }, 5 * 60 * 1000); // 5 minutes
              
            } catch (err) {
              console.log(chalk.red('❌ Échec de l\'envoi de l\'annonce:'), err.response?.data || err.message);
            }
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
 * Commande pour créer un poll
 */
program
  .command('poll')
  .description('Créer un poll Twitch')
  .option('-d, --duration <seconds>', 'Durée du poll en secondes', '60')
  .option('-e, --end', 'Terminer tous les polls actifs')
  .action(async (options) => {
    try {
      // Si on veut terminer tous les polls actifs
      if (options.end) {
        if (!twitchAuth.isAuthenticated()) {
          const hasValidTokens = await twitchAuth.initialize();
          if (!hasValidTokens) {
            console.log(chalk.red('❌ Authentification requise'));
            return;
          }
        }
        const active = await twitchApi.getActivePolls();
        if (!active || active.length === 0) {
          console.log(chalk.yellow('📊 Aucun poll actif'));
          return;
        }
        for (const p of active) {
          await twitchApi.endPoll(p.id);
          console.log(chalk.green(`✅ Poll terminé: ${p.id}`));
        }
        return;
      }

      // Charger les sondages
      await sondageManager.loadSondages();
      
      // Vérifier l'authentification
      if (!twitchAuth.isAuthenticated()) {
        // Essayer de charger les tokens sauvegardés
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
      
      // Vérifier à nouveau après le chargement des tokens
      if (!twitchAuth.isAuthenticated()) {
        console.log(chalk.red('❌ Impossible de continuer sans authentification'));
        return;
      }
      
      // Vérifier si l'utilisateur est en live
      const isLive = await twitchApi.isUserLive();
      if (!isLive) {
        console.log(chalk.yellow('⚠️  Vous n\'êtes pas en live. Le poll sera créé mais ne sera pas visible.'));
      }
      
      // Utiliser un sondage aléatoire disponible
      const availableSondages = sondageManager.getAvailableSondages();
      if (availableSondages.length === 0) {
        console.log(chalk.red('❌ Aucun sondage disponible'));
        return;
      }
      
      const randomIndex = Math.floor(Math.random() * availableSondages.length);
      const selectedSondage = availableSondages[randomIndex];
      
      console.log(chalk.blue(`🎲 Sondage sélectionné au hasard: "${selectedSondage.question}"`));
      
      // Créer le poll
      const duration = parseInt(options.duration);
      const poll = await twitchApi.createPollFromQuestion(selectedSondage, duration);
      
      // Marquer le sondage comme utilisé
      const sondageIndex = sondageManager.sondages.findIndex(q => q === selectedSondage);
      await sondageManager.markSondageAsUsed(sondageIndex);
      
      // Afficher le nombre de sondages restants
      const remaining = sondageManager.getAvailableSondages().length;
      console.log(chalk.green(`🎉 Poll créé avec succès! (${remaining} sondages restants)`));
      
    } catch (error) {
      console.error(chalk.red('❌ Erreur:'), error.message);
    }
  });

/**
 * Commande pour gérer les sondages
 */
program
  .command('sondages')
  .description('Gérer les sondages')
  .option('-l, --list', 'Lister tous les sondages')
  .option('-s, --status', 'Afficher le statut des sondages')
  .option('-i, --info', 'Afficher les informations détaillées (statut + liste)')
  .option('-a, --add', 'Ajouter un nouveau sondage')
  .option('-r, --reset', 'Réinitialiser tous les sondages (non interactif)')
  .action(async (options) => {
    try {
      await sondageManager.loadSondages();
      
      if (options.info) {
        sondageManager.displaySondagesStatus();
        sondageManager.displayAllSondages();
      } else if (options.list) {
        sondageManager.displayAllSondages();
      } else if (options.status) {
        sondageManager.displaySondagesStatus();
      } else if (options.add) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'question',
            message: 'Entrez la question:',
            validate: (input) => input.trim() !== '' || 'La question ne peut pas être vide'
          },
          {
            type: 'input',
            name: 'answers',
            message: 'Entrez les réponses (séparées par des virgules):',
            validate: (input) => {
              const answers = input.split(',').map(a => a.trim()).filter(a => a !== '');
              return answers.length >= 2 || 'Au moins 2 réponses sont requises';
            }
          }
        ]);
        
        const answerList = answers.answers.split(',').map(a => a.trim()).filter(a => a !== '');
        await sondageManager.addSondage(answers.question, answerList);
      } else if (options.reset) {
        await sondageManager.resetAllSondages();
        console.log(chalk.green('🔄 Tous les sondages ont été réinitialisés (status=true)'));
      } else {
        sondageManager.displaySondagesStatus();
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Erreur:'), error.message);
    }
  });

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
 * Commande pour les polls existants
 */
program
  .command('polls')
  .description('Gérer les polls existants')
  .option('-l, --list', 'Lister les polls actifs')
  .option('-e, --end <pollId>', 'Terminer un poll')
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
        const polls = await twitchApi.getActivePolls();
        if (polls.length === 0) {
          console.log(chalk.yellow('📊 Aucun poll actif'));
        } else {
          console.log(chalk.blue('📊 Polls actifs:'));
          polls.forEach(poll => {
            console.log(`   🆔 ${poll.id}: ${poll.title}`);
            console.log(`   ⏱️  Durée: ${poll.duration} secondes`);
            console.log(`   📊 Statut: ${poll.status}`);
            console.log('');
          });
        }
      } else if (options.end) {
        await twitchApi.endPoll(options.end);
        console.log(chalk.green('✅ Poll terminé'));
      } else {
        console.log(chalk.yellow('Utilisez --help pour voir les options disponibles'));
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Erreur:'), error.message);
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
  
  console.log('\n📊 SONDAGES:');
  console.log('  npm run sondages -- --status               Afficher le statut (compteur)');
  console.log('  npm run sondages -- --list                 Lister tous les sondages');
  console.log('  npm run sondages -- --info                 Statut + liste complète');
  console.log('  npm run sondages -- --add                  Ajouter un sondage');
  console.log('  npm run sondages -- --reset                Réinitialiser tous les sondages (status=true)');
  
  console.log('\n🗳️  POLL (Création):');
  console.log('  npm run poll                               Créer un poll (sondage aléatoire)');
  console.log('  npm run poll -- --duration <seconds>       Durée personnalisée (défaut: 60s)');
  console.log('  npm run poll -- --end                      Terminer tous les polls actifs');
  
  console.log('\n📋 POLLS (Gestion):');
  console.log('  npm run polls -- --list                    Lister les polls actifs');
  console.log('  npm run polls -- --end <poll_id>           Terminer un poll par ID');
  
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
  console.log('  npm run engine                             Surveille les rewards et lance des actions');
  console.log('  npm run engine -- --reward <reward_id>     Spécifier un autre reward de sondage');
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
  console.log('  files/sondage.json                        Questions pour les polls');
  console.log('  files/questions.json                      Questions pour les annonces');
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
    
    console.log('\n📊 SONDAGES:');
    console.log('  npm run sondages -- --status               Afficher le statut (compteur)');
    console.log('  npm run sondages -- --list                 Lister tous les sondages');
    console.log('  npm run sondages -- --info                 Statut + liste complète');
    console.log('  npm run sondages -- --add                  Ajouter un sondage');
    console.log('  npm run sondages -- --reset                Réinitialiser tous les sondages (status=true)');
    
    console.log('\n🗳️  POLL (Création):');
    console.log('  npm run poll                               Créer un poll (sondage aléatoire)');
    console.log('  npm run poll -- --duration <seconds>       Durée personnalisée (défaut: 60s)');
    console.log('  npm run poll -- --end                      Terminer tous les polls actifs');
    
    console.log('\n📋 POLLS (Gestion):');
    console.log('  npm run polls -- --list                    Lister les polls actifs');
    console.log('  npm run polls -- --end <poll_id>           Terminer un poll par ID');
    
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
    console.log('  npm run engine                             Surveille les rewards et lance des actions');
    console.log('  npm run engine -- --reward <reward_id>     Spécifier un autre reward de sondage');
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
    console.log('  files/sondage.json                        Questions pour les polls');
    console.log('  files/questions.json                      Questions pour les annonces');
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
