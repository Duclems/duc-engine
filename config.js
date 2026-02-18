import dotenv from 'dotenv';

dotenv.config();

export const config = {
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID || 'uiuvz5c2cwt1vwcgzb8k6pcw3gv88v',
    clientSecret: process.env.TWITCH_CLIENT_SECRET || 'bjecl8alfg12ozk5m34p3diy1ifj6h',
    redirectUri: 'http://localhost:3002/auth/callback',
    scopes: [
      'channel:manage:polls',
      'channel:read:polls',
      'channel:read:redemptions',
      'channel:manage:redemptions',
      'user:read:email',
      'moderation:read',
      'user:write:chat',
      'moderator:manage:announcements',
      'moderator:manage:shoutouts'
    ]
  },
  // Configuration des timeouts et connexions
  timeouts: {
    apiRequest: 30000,        // 30 secondes pour les requêtes API
    tokenValidation: 15000,   // 15 secondes pour valider les tokens
    connectionRetry: 5000,    // 5 secondes entre les tentatives de reconnexion
    maxRetries: 5             // Nombre maximum de tentatives
  },
  // Configuration des tokens
  tokens: {
    extendedLifetime: true,           // Activer la durée de vie étendue
    minValidityHours: 24 * 7,         // Minimum 7 jours de validité
    refreshThresholdHours: 24,        // Rafraîchir si moins de 24h restantes
    saveInterval: 60 * 60 * 1000      // Sauvegarder les tokens toutes les heures
  },
  port: process.env.PORT || 3002
};
