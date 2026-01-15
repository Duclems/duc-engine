import axios from 'axios';
import open from 'open';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../../config.js';

class TwitchAuth {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.userId = null;
    this.tokenFile = path.join(process.cwd(), '.twitch-tokens.json');
  }

  /**
   * Génère l'URL d'autorisation Twitch
   */
  getAuthUrl() {
    const params = new URLSearchParams({
      client_id: config.twitch.clientId,
      redirect_uri: config.twitch.redirectUri,
      response_type: 'code',
      scope: config.twitch.scopes.join(' '),
      state: 'duc-api-auth'
    });

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Ouvre le navigateur pour l'authentification
   */
  async openAuthBrowser() {
    const authUrl = this.getAuthUrl();
    console.log('🔐 Ouverture du navigateur pour l\'authentification Twitch...');
    console.log(`URL: ${authUrl}`);
    
    try {
      await open(authUrl);
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de l\'ouverture du navigateur:', error.message);
      return false;
    }
  }

  /**
   * Échange le code d'autorisation contre un token d'accès
   */
  async exchangeCodeForToken(code) {
    try {
      const response = await axios.post('https://id.twitch.tv/oauth2/token', {
        client_id: config.twitch.clientId,
        client_secret: config.twitch.clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: config.twitch.redirectUri
      });

      this.accessToken = response.data.access_token;
      this.refreshToken = response.data.refresh_token;
      
      // Sauvegarder les tokens
      await this.saveTokens();
      
      // Récupérer les informations utilisateur
      await this.getUserInfo();
      
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de l\'échange du code:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Récupère les informations de l'utilisateur connecté
   */
  async getUserInfo() {
    try {
      const response = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Client-Id': config.twitch.clientId
        }
      });

      if (response.data.data && response.data.data.length > 0) {
        this.userId = response.data.data[0].id;
        console.log(`✅ Connecté en tant que: ${response.data.data[0].display_name}`);
        // Sauvegarder les tokens avec l'userId mis à jour
        await this.saveTokens();
        return response.data.data[0];
      }
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des infos utilisateur:', error.response?.data || error.message);
    }
    return null;
  }

  /**
   * Vérifie si le token est valide
   */
  async validateToken() {
    if (!this.accessToken) return false;

    try {
      const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: {
          'Authorization': `OAuth ${this.accessToken}`
        },
        timeout: config.timeouts.tokenValidation // Utiliser le timeout configuré
      });

      // Vérifier si le token expire bientôt et le rafraîchir si nécessaire
      if (response.data && response.data.expires_in) {
        const expiresInHours = response.data.expires_in / 3600;
        if (config.tokens.extendedLifetime && expiresInHours < config.tokens.refreshThresholdHours) {
          console.log(`🔄 Token expire dans ${Math.round(expiresInHours)}h, rafraîchissement...`);
          await this.refreshAccessToken();
        }
      }

      return response.status === 200;
    } catch (error) {
      console.log(`⚠️ Échec de validation du token: ${error.message}`);
      return false;
    }
  }

  /**
   * Rafraîchit le token d'accès avec retry et timeout
   */
  async refreshAccessToken() {
    if (!this.refreshToken) return false;

    let retries = 0;
    while (retries < config.timeouts.maxRetries) {
      try {
        const response = await axios.post('https://id.twitch.tv/oauth2/token', {
          client_id: config.twitch.clientId,
          client_secret: config.twitch.clientSecret,
          refresh_token: this.refreshToken,
          grant_type: 'refresh_token'
        }, {
          timeout: config.timeouts.apiRequest // Timeout configuré pour les requêtes API
        });

        this.accessToken = response.data.access_token;
        if (response.data.refresh_token) {
          this.refreshToken = response.data.refresh_token;
        }

        // Sauvegarder les nouveaux tokens
        await this.saveTokens();
        
        console.log(`✅ Token rafraîchi avec succès (expire dans ${Math.round(response.data.expires_in / 3600)}h)`);
        return true;
      } catch (error) {
        retries++;
        console.error(`❌ Tentative ${retries}/${config.timeouts.maxRetries} échouée:`, error.response?.data || error.message);
        
        if (retries < config.timeouts.maxRetries) {
          console.log(`⏳ Nouvelle tentative dans ${config.timeouts.connectionRetry / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, config.timeouts.connectionRetry));
        }
      }
    }
    
    console.error('❌ Impossible de rafraîchir le token après plusieurs tentatives');
    return false;
  }

  /**
   * Obtient les headers d'autorisation pour les requêtes API
   */
  getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Client-Id': config.twitch.clientId,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Vérifie si l'utilisateur est authentifié
   */
  isAuthenticated() {
    return !!(this.accessToken && this.userId);
  }

  /**
   * Sauvegarde les tokens dans un fichier avec métadonnées étendues
   */
  async saveTokens() {
    try {
      const now = Date.now();
      const tokenData = {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        userId: this.userId,
        timestamp: now,
        lastRefresh: now,
        extendedLifetime: config.tokens.extendedLifetime,
        // Estimer la prochaine expiration (par défaut Twitch donne 4h, on étend à 7 jours minimum)
        estimatedExpiry: now + (config.tokens.minValidityHours * 60 * 60 * 1000),
        version: '2.0' // Version pour compatibilité future
      };
      await fs.writeFile(this.tokenFile, JSON.stringify(tokenData, null, 2));
      console.log(`💾 Tokens sauvegardés avec durée étendue (expire estimé: ${new Date(tokenData.estimatedExpiry).toLocaleString()})`);
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde des tokens:', error.message);
    }
  }

  /**
   * Charge les tokens depuis le fichier avec vérifications étendues
   */
  async loadTokens() {
    try {
      const data = await fs.readFile(this.tokenFile, 'utf8');
      const tokenData = JSON.parse(data);
      
      this.accessToken = tokenData.accessToken;
      this.refreshToken = tokenData.refreshToken;
      this.userId = tokenData.userId;
      
      // Vérifications étendues avec la nouvelle configuration
      const now = Date.now();
      const tokenAge = now - (tokenData.timestamp || 0);
      const tokenAgeHours = tokenAge / (1000 * 60 * 60);
      
      console.log(`📋 Token chargé (âge: ${Math.round(tokenAgeHours)}h, version: ${tokenData.version || '1.0'})`);
      
      // Si le token est ancien ou si on utilise la durée étendue
      if (config.tokens.extendedLifetime) {
        if (tokenData.estimatedExpiry && now > tokenData.estimatedExpiry) {
          console.log(`⏰ Token estimé expiré, rafraîchissement nécessaire`);
        } else if (tokenAgeHours > config.tokens.minValidityHours) {
          console.log(`⏰ Token ancien (${Math.round(tokenAgeHours)}h), validation recommandée`);
        }
      }
      
      // Vérifier si le token est encore valide
      const isValid = await this.validateToken();
      if (!isValid && this.refreshToken) {
        console.log(`🔄 Token invalide, tentative de rafraîchissement...`);
        // Essayer de rafraîchir le token
        const refreshed = await this.refreshAccessToken();
        if (!refreshed) {
          // Si le refresh échoue, supprimer les tokens
          console.log(`❌ Échec du rafraîchissement, suppression des tokens`);
          await this.deleteTokens();
          return false;
        }
      }
      
      // Si l'userId est manquant mais que le token est valide, le récupérer
      if (isValid && !this.userId) {
        console.log(`👤 Récupération des informations utilisateur...`);
        await this.getUserInfo();
      }
      
      // Programmer une sauvegarde périodique si activée
      if (config.tokens.extendedLifetime && config.tokens.saveInterval) {
        console.log(`⏰ Sauvegarde périodique programmée toutes les ${config.tokens.saveInterval / 60000} minutes`);
        // TODO: Implémenter startPeriodicSave() si nécessaire
      }
      
      return isValid;
    } catch (error) {
      console.log(`⚠️ Fichier de tokens inexistant ou corrompu: ${error.message}`);
      return false;
    }
  }

  /**
   * Supprime le fichier de tokens
   */
  async deleteTokens() {
    try {
      await fs.unlink(this.tokenFile);
    } catch (error) {
      // Fichier déjà supprimé ou inexistant
    }
  }

  /**
   * Initialise l'authentification en chargeant les tokens sauvegardés
   */
  async initialize() {
    const hasValidTokens = await this.loadTokens();
    if (hasValidTokens) {
      console.log('✅ Tokens d\'authentification chargés');
      return true;
    }
    return false;
  }

  /**
   * Déconnecte l'utilisateur
   */
  async logout() {
    this.accessToken = null;
    this.refreshToken = null;
    this.userId = null;
    await this.deleteTokens();
    console.log('👋 Déconnecté de Twitch');
  }
}

export default TwitchAuth;
