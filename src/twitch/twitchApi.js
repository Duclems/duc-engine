import axios from 'axios';

class TwitchApi {
  constructor(twitchAuth) {
    this.auth = twitchAuth;
    this.baseUrl = 'https://api.twitch.tv/helix';
  }

  /**
   * Crée un poll sur Twitch
   */
  async createPoll(title, choices, duration = 60) {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/polls`,
        {
          broadcaster_id: this.auth.userId,
          title: title,
          choices: choices.map((choice, index) => ({
            title: choice
          })),
          duration: duration
        },
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      console.log('✅ Poll créé avec succès!');
      console.log(`📊 Titre: ${title}`);
      console.log(`⏱️ Durée: ${duration} secondes`);
      console.log(`🆔 ID du poll: ${response.data.data[0].id}`);
      
      return response.data.data[0];
    } catch (error) {
      console.error('❌ Erreur lors de la création du poll:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Récupère les polls actifs
   */
  async getActivePolls() {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/polls?broadcaster_id=${this.auth.userId}`,
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data.data;
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des polls:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Termine un poll
   */
  async endPoll(pollId, status = 'TERMINATED') {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.patch(
        `${this.baseUrl}/polls`,
        {
          broadcaster_id: this.auth.userId,
          id: pollId,
          status: status
        },
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      console.log(`✅ Poll ${pollId} terminé`);
      return response.data.data[0];
    } catch (error) {
      console.error('❌ Erreur lors de la fin du poll:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Récupère les informations du canal
   */
  async getChannelInfo() {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/channels?broadcaster_id=${this.auth.userId}`,
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data.data[0];
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des infos du canal:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Récupère les informations d'un canal par userId
   */
  async getChannelInfoByUserId(userId) {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/channels?broadcaster_id=${userId}`,
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      if (response.data.data && response.data.data.length > 0) {
        return response.data.data[0];
      }
      return null;
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des infos du canal:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Vérifie si l'utilisateur est en live
   */
  async isUserLive() {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/streams?user_id=${this.auth.userId}`,
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data.data.length > 0;
    } catch (error) {
      console.error('❌ Erreur lors de la vérification du statut live:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Crée un poll à partir d'une question du JSON
   */
  async createPollFromQuestion(question, duration = 60) {
    const validation = this.validatePollData(question);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    return await this.createPoll(question.question, question.answers, duration);
  }

  /**
   * Récupère les rewards de points du canal
   */
  async getChannelRewards() {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/channel_points/custom_rewards?broadcaster_id=${this.auth.userId}`,
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data.data;
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des rewards:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Met à jour un reward (active/désactive)
   */
  async updateReward(rewardId, isEnabled) {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.patch(
        `${this.baseUrl}/channel_points/custom_rewards?broadcaster_id=${this.auth.userId}&id=${rewardId}`,
        {
          is_enabled: isEnabled
        },
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data.data[0];
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour du reward:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Met à jour la limite de redemptions par stream d'un reward
   */
  async updateRewardRedemptionLimit(rewardId, maxPerStream) {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      // Toujours inclure les deux champs ensemble
      const payload = {
        max_per_stream: maxPerStream > 0 ? maxPerStream : 1,
        is_max_per_stream_enabled: maxPerStream > 0
      };

      const response = await axios.patch(
        `${this.baseUrl}/channel_points/custom_rewards?broadcaster_id=${this.auth.userId}&id=${rewardId}`,
        payload,
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data.data[0];
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour de la limite du reward:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Met à jour le cooldown global d'un reward
   */
  async updateRewardCooldown(rewardId, cooldownSeconds) {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const payload = {
        global_cooldown_seconds: cooldownSeconds,
        is_global_cooldown_enabled: cooldownSeconds > 0
      };

      const response = await axios.patch(
        `${this.baseUrl}/channel_points/custom_rewards?broadcaster_id=${this.auth.userId}&id=${rewardId}`,
        payload,
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data.data[0];
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour du cooldown du reward:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Récupère les redemptions pour un reward donné
   */
  async getRewardRedemptions(rewardId, status = 'UNFULFILLED', after = null) {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const params = new URLSearchParams({
        broadcaster_id: this.auth.userId,
        reward_id: rewardId,
        status: status,
        first: '50'
      });
      if (after) params.append('after', after);

      const response = await axios.get(
        `${this.baseUrl}/channel_points/custom_rewards/redemptions?${params.toString()}`,
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des redemptions:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Valide les données d'un poll
   */
  validatePollData(question) {
    if (!question.question || question.question.trim() === '') {
      return { valid: false, error: 'La question ne peut pas être vide' };
    }

    if (!question.answers || question.answers.length < 2) {
      return { valid: false, error: 'Une question doit avoir au moins 2 réponses' };
    }

    if (question.answers.length > 5) {
      return { valid: false, error: 'Une question ne peut pas avoir plus de 5 réponses' };
    }

    // Vérifier que les réponses ne sont pas vides
    for (const answer of question.answers) {
      if (!answer || answer.trim() === '') {
        return { valid: false, error: 'Les réponses ne peuvent pas être vides' };
      }
    }

    return { valid: true };
  }

  /**
   * Envoie une annonce épinglée sur le chat
   */
  async sendAnnouncement(message, color = 'blue') {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/announcements`,
        {
          broadcaster_id: this.auth.userId,
          moderator_id: this.auth.userId,
          message: message,
          color: color
        },
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Erreur lors de l\'envoi de l\'annonce:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Crée un nouveau reward de points de chaîne
   */
  async createChannelReward(rewardData) {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/channel_points/custom_rewards?broadcaster_id=${this.auth.userId}`,
        {
          title: rewardData.title,
          cost: rewardData.cost,
          prompt: rewardData.prompt || '',
          background_color: rewardData.background_color || '#9146FF',
          is_enabled: rewardData.is_enabled || false,
          is_user_input_required: rewardData.is_user_input_required || false,
          should_redemptions_skip_request_queue: rewardData.should_redemptions_skip_request_queue || false
        },
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data.data[0];
    } catch (error) {
      console.error('❌ Erreur lors de la création du reward:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Récupère les modérateurs de la chaîne
   */
  async getModerators() {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/moderation/moderators?broadcaster_id=${this.auth.userId}`,
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data.data || [];
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des modérateurs:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Récupère les informations d'un utilisateur par son nom d'utilisateur
   */
  async getUserByUsername(username) {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/users?login=${username}`,
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Erreur lors de la récupération de l\'utilisateur:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fait un shoutout à un utilisateur
   */
  async shoutout(targetUserId) {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/shoutouts`,
        {
          from_broadcaster_id: this.auth.userId,
          to_broadcaster_id: targetUserId,
          moderator_id: this.auth.userId
        },
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      console.log(`✅ Shoutout envoyé à l'utilisateur ${targetUserId}`);
      return response.data;
    } catch (error) {
      console.error('❌ Erreur lors du shoutout:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Envoie un message dans le chat via l'API Twitch
   */
  async sendChatMessage(message) {
    if (!this.auth.isAuthenticated()) {
      throw new Error('Non authentifié avec Twitch');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/messages`,
        {
          broadcaster_id: this.auth.userId,
          sender_id: this.auth.userId,
          message: message
        },
        {
          headers: this.auth.getAuthHeaders()
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Erreur lors de l\'envoi du message chat:', error.response?.data || error.message);
      throw error;
    }
  }
}

export default TwitchApi;
