import express from 'express';
import cors from 'cors';
import { config } from '../../config.js';
import SondageManager from '../sondages/sondageManager.js';
import TwitchAuth from '../auth/twitchAuth.js';
import TwitchApi from '../twitch/twitchApi.js';

class ApiServer {
  constructor() {
    this.app = express();
    this.port = 3002;
    this.sondageManager = new SondageManager();
    this.twitchAuth = new TwitchAuth();
    this.twitchApi = new TwitchApi(this.twitchAuth);
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Initialise l'authentification Twitch
   */
  async initializeAuth() {
    try {
      const hasValidTokens = await this.twitchAuth.initialize();
      if (!hasValidTokens) {
        console.warn('⚠️  Aucun token Twitch valide trouvé. Certaines routes nécessitent une authentification.');
        return false;
      }
      console.log('✅ Authentification Twitch initialisée pour l\'API');
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de l\'initialisation de l\'authentification:', error.message);
      return false;
    }
  }

  setupMiddleware() {
    // CORS pour permettre l'accès depuis d'autres applications
    this.app.use(cors({
      origin: ['http://localhost:3011', 'http://localhost:3001', 'http://localhost:2999', 'http://localhost:3002', 'http://localhost:3000'],
      credentials: true
    }));
    
    // Parse JSON
    this.app.use(express.json());
    
    // Logging des requêtes
    this.app.use((req, res, next) => {
      console.log(`[API] ${req.method} ${req.path} - ${new Date().toISOString()}`);
      next();
    });
  }

  setupRoutes() {
    // Route de santé
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'duc-engine-api'
      });
    });

    // Route pour récupérer les annonces disponibles
    this.app.get('/api/announcements', async (req, res) => {
      try {
        const announcements = await this.sondageManager.getAvailableAnnouncementQuestions();
        res.json({
          success: true,
          data: announcements,
          count: announcements.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ Erreur lors de la récupération des annonces:', error.message);
        res.status(500).json({
          success: false,
          error: 'Erreur lors de la récupération des annonces',
          message: error.message
        });
      }
    });

    // Route pour récupérer le contenu d'une question spécifique
    this.app.get('/api/announcements/questions/:questionId', async (req, res) => {
      try {
        const { questionId } = req.params;
        const questionsData = await this.sondageManager.loadAnnouncementQuestions();
        const question = questionsData.poll.find(q => q.question === questionId);
        
        if (!question) {
          return res.status(404).json({
            success: false,
            error: 'Question non trouvée',
            message: `Aucune question trouvée avec l'ID: ${questionId}`
          });
        }

        res.json({
          success: true,
          data: question,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ Erreur lors de la récupération de la question:', error.message);
        res.status(500).json({
          success: false,
          error: 'Erreur lors de la récupération de la question',
          message: error.message
        });
      }
    });

    // Route pour récupérer toutes les questions (disponibles et utilisées)
    this.app.get('/api/announcements/questions', async (req, res) => {
      try {
        const questionsData = await this.sondageManager.loadAnnouncementQuestions();
        const { available } = req.query;
        
        let questions = questionsData.poll;
        
        // Filtrer seulement les questions disponibles si demandé
        if (available === 'true') {
          questions = questions.filter(q => q.status === true);
        }
        
        res.json({
          success: true,
          data: questions,
          count: questions.length,
          filtered: available === 'true',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ Erreur lors de la récupération des questions:', error.message);
        res.status(500).json({
          success: false,
          error: 'Erreur lors de la récupération des questions',
          message: error.message
        });
      }
    });

    // Route pour récupérer une question aléatoire
    this.app.get('/api/announcements/random', async (req, res) => {
      try {
        const randomQuestion = await this.sondageManager.getRandomAnnouncementQuestion();
        
        if (!randomQuestion) {
          return res.status(404).json({
            success: false,
            error: 'Aucune question disponible',
            message: 'Toutes les questions d\'annonce ont été utilisées'
          });
        }

        res.json({
          success: true,
          data: randomQuestion,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ Erreur lors de la récupération d\'une question aléatoire:', error.message);
        res.status(500).json({
          success: false,
          error: 'Erreur lors de la récupération d\'une question aléatoire',
          message: error.message
        });
      }
    });

    // Route pour récupérer la question d'annonce actuellement en cours
    this.app.get('/api/announcements/current', async (req, res) => {
      try {
        const currentQuestion = await this.sondageManager.getCurrentAnnouncementQuestion();
        
        if (!currentQuestion) {
          return res.status(404).json({
            success: false,
            error: 'Aucune question d\'annonce en cours',
            message: 'Aucune question d\'annonce n\'est actuellement affichée',
            data: null
          });
        }

        res.json({
          success: true,
          data: currentQuestion,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ Erreur lors de la récupération de la question en cours:', error.message);
        res.status(500).json({
          success: false,
          error: 'Erreur lors de la récupération de la question en cours',
          message: error.message
        });
      }
    });

    // Route pour récupérer le shoutout actuellement en cours
    this.app.get('/api/shoutout/current', async (req, res) => {
      try {
        const currentShoutout = await this.sondageManager.getCurrentShoutout();
        
        if (!currentShoutout) {
          return res.status(404).json({
            success: false,
            error: 'Aucun shoutout en cours',
            message: 'Aucun shoutout n\'est actuellement affiché',
            data: null
          });
        }

        res.json({
          success: true,
          data: currentShoutout,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ Erreur lors de la récupération du shoutout en cours:', error.message);
        res.status(500).json({
          success: false,
          error: 'Erreur lors de la récupération du shoutout en cours',
          message: error.message
        });
      }
    });

    // Route pour récupérer les informations d'un canal Twitch
    this.app.get('/api/twitch/channel/:userId', async (req, res) => {
      try {
        const { userId } = req.params;

        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'Paramètre manquant',
            message: 'Le paramètre userId est requis'
          });
        }

        // Vérifier que l'authentification est disponible
        if (!this.twitchAuth.isAuthenticated()) {
          const initialized = await this.initializeAuth();
          if (!initialized) {
            return res.status(503).json({
              success: false,
              error: 'Authentification non disponible',
              message: 'L\'authentification Twitch n\'est pas configurée. Veuillez configurer les tokens Twitch.'
            });
          }
        }

        const channelInfo = await this.twitchApi.getChannelInfoByUserId(userId);

        if (!channelInfo) {
          return res.status(404).json({
            success: false,
            error: 'Canal non trouvé',
            message: `Aucun canal trouvé pour l'utilisateur ID: ${userId}`
          });
        }

        res.json({
          success: true,
          data: {
            broadcaster_id: channelInfo.broadcaster_id,
            broadcaster_name: channelInfo.broadcaster_name,
            broadcaster_language: channelInfo.broadcaster_language,
            game_id: channelInfo.game_id,
            game_name: channelInfo.game_name,
            title: channelInfo.title,
            delay: channelInfo.delay,
            description: channelInfo.description || ''
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ Erreur lors de la récupération des infos du canal:', error.message);
        
        // Gérer les erreurs spécifiques de l'API Twitch
        if (error.response) {
          const status = error.response.status;
          const errorData = error.response.data;

          if (status === 401 || status === 403) {
            return res.status(401).json({
              success: false,
              error: 'Non autorisé',
              message: 'Token d\'authentification invalide ou expiré'
            });
          }

          if (status === 404) {
            return res.status(404).json({
              success: false,
              error: 'Canal non trouvé',
              message: errorData.message || 'Le canal spécifié n\'existe pas'
            });
          }
        }

        res.status(500).json({
          success: false,
          error: 'Erreur lors de la récupération des infos du canal',
          message: error.message
        });
      }
    });

    // Route 404
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint non trouvé',
        message: `L'endpoint ${req.method} ${req.originalUrl} n'existe pas`,
        availableEndpoints: [
          'GET /health',
          'GET /api/announcements',
          'GET /api/announcements/questions',
          'GET /api/announcements/questions/:questionId',
          'GET /api/announcements/random',
          'GET /api/announcements/current',
          'GET /api/shoutout/current',
          'GET /api/twitch/channel/:userId'
        ]
      });
    });
  }

  async start() {
    // Initialiser l'authentification Twitch au démarrage
    await this.initializeAuth();

    this.server = this.app.listen(this.port, () => {
      console.log(`🚀 Serveur API Duc Engine démarré sur le port ${this.port}`);
      console.log(`📡 Endpoints disponibles:`);
      console.log(`   - GET http://localhost:${this.port}/health`);
      console.log(`   - GET http://localhost:${this.port}/api/announcements`);
      console.log(`   - GET http://localhost:${this.port}/api/announcements/questions`);
      console.log(`   - GET http://localhost:${this.port}/api/announcements/questions/:questionId`);
      console.log(`   - GET http://localhost:${this.port}/api/announcements/random`);
      console.log(`   - GET http://localhost:${this.port}/api/announcements/current`);
      console.log(`   - GET http://localhost:${this.port}/api/shoutout/current`);
      console.log(`   - GET http://localhost:${this.port}/api/twitch/channel/:userId`);
    });

    // Gestion gracieuse de l'arrêt
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  stop() {
    if (this.server) {
      this.server.close(() => {
        console.log('🛑 Serveur API Duc Engine arrêté');
      });
    }
  }
}

export default ApiServer;
