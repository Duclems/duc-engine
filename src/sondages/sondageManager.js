import fs from 'fs/promises';
import path from 'path';

class SondageManager {
  constructor(sondagesFilePath = 'files/sondage.json') {
    this.sondagesFilePath = sondagesFilePath;
    this.sondages = [];
    this.lastModified = 0;
    this.currentAnnouncementQuestion = null;
    this.announcementStartTime = null;
    this.currentShoutout = null;
    this.shoutoutStartTime = null;
  }

  /**
   * Charge les sondages depuis le fichier JSON
   */
  async loadSondages(silent = false) {
    try {
      const data = await fs.readFile(this.sondagesFilePath, 'utf8');
      const jsonData = JSON.parse(data);
      this.sondages = jsonData.poll || [];
      if (!silent) {
        const available = this.getAvailableSondages().length;
        console.log(`📋 ${this.sondages.length} sondages chargés (${available} disponibles)`);
      }
      return this.sondages;
    } catch (error) {
      console.error('❌ Erreur lors du chargement des sondages:', error.message);
      return [];
    }
  }

  /**
   * Vérifie si le fichier a été modifié et recharge si nécessaire
   */
  async checkAndReloadIfNeeded(silent = true) {
    try {
      const stats = await fs.stat(this.sondagesFilePath);
      const currentModified = stats.mtime.getTime();
      
      if (currentModified > this.lastModified) {
        this.lastModified = currentModified;
        await this.loadSondages(silent);
        return true; // Fichier rechargé
      }
      return false; // Pas de changement
    } catch (error) {
      console.error('❌ Erreur lors de la vérification du fichier:', error.message);
      return false;
    }
  }

  /**
   * Vérifie si le fichier questions.json a été modifié
   */
  async checkAnnouncementQuestionsFileModified() {
    try {
      const stats = await fs.stat('files/questions.json');
      const currentModified = stats.mtime.getTime();
      
      // Stocker le timestamp de la dernière modification des questions
      if (!this.questionsLastModified) {
        this.questionsLastModified = currentModified;
        return false; // Premier chargement
      }
      
      if (currentModified > this.questionsLastModified) {
        this.questionsLastModified = currentModified;
        return true; // Fichier modifié
      }
      return false; // Pas de changement
    } catch (error) {
      console.error('❌ Erreur lors de la vérification du fichier questions.json:', error.message);
      return false;
    }
  }

  /**
   * Sauvegarde les sondages dans le fichier JSON
   */
  async saveSondages() {
    try {
      const data = {
        poll: this.sondages
      };
      await fs.writeFile(this.sondagesFilePath, JSON.stringify(data, null, 2));
      console.log('💾 Sondages sauvegardés');
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde des sondages:', error.message);
      return false;
    }
  }

  /**
   * Récupère le prochain sondage disponible (status: true)
   */
  getNextAvailableSondage() {
    return this.sondages.find(sondage => sondage.status === true);
  }

  /**
   * Récupère tous les sondages disponibles
   */
  getAvailableSondages() {
    return this.sondages.filter(sondage => sondage.status === true);
  }

  /**
   * Récupère tous les sondages utilisés
   */
  getUsedSondages() {
    return this.sondages.filter(sondage => sondage.status === false);
  }

  /**
   * Marque un sondage comme utilisé (status: false)
   */
  async markSondageAsUsed(sondageIndex) {
    if (sondageIndex >= 0 && sondageIndex < this.sondages.length) {
      this.sondages[sondageIndex].status = false;
      await this.saveSondages();
      console.log(`✅ Sondage "${this.sondages[sondageIndex].question}" marqué comme utilisé`);
      return true;
    }
    return false;
  }

  /**
   * Marque un sondage comme disponible (status: true)
   */
  async markSondageAsAvailable(sondageIndex) {
    if (sondageIndex >= 0 && sondageIndex < this.sondages.length) {
      this.sondages[sondageIndex].status = true;
      await this.saveSondages();
      console.log(`✅ Sondage "${this.sondages[sondageIndex].question}" marqué comme disponible`);
      return true;
    }
    return false;
  }

  /**
   * Ajoute un nouveau sondage
   */
  async addSondage(question, answers) {
    const newSondage = {
      question: question,
      status: true,
      answers: answers
    };
    
    this.sondages.push(newSondage);
    await this.saveSondages();
    console.log(`✅ Nouveau sondage ajouté: "${question}"`);
    return newSondage;
  }

  /**
   * Supprime un sondage
   */
  async removeSondage(sondageIndex) {
    if (sondageIndex >= 0 && sondageIndex < this.sondages.length) {
      const removedSondage = this.sondages.splice(sondageIndex, 1)[0];
      await this.saveSondages();
      console.log(`🗑️ Sondage supprimé: "${removedSondage.question}"`);
      return removedSondage;
    }
    return null;
  }

  /**
   * Réinitialise tous les sondages (status: true)
   */
  async resetAllSondages() {
    this.sondages.forEach(sondage => {
      sondage.status = true;
    });
    await this.saveSondages();
    console.log('🔄 Tous les sondages ont été réinitialisés');
  }

  /**
   * Affiche le statut des sondages
   */
  displaySondagesStatus() {
    const available = this.getAvailableSondages().length;
    const used = this.getUsedSondages().length;
    const total = this.sondages.length;

    console.log('\n📊 Statut des sondages:');
    console.log(`   Total: ${total}`);
    console.log(`   Disponibles: ${available}`);
    console.log(`   Utilisés: ${used}`);
    
    if (available > 0) {
      console.log('\n📋 Sondages disponibles:');
      this.getAvailableSondages().forEach((sondage, index) => {
        console.log(`   ${index + 1}. ${sondage.question}`);
      });
    }
  }

  /**
   * Affiche tous les sondages avec leur statut
   */
  displayAllSondages() {
    console.log('\n📋 Tous les sondages:');
    this.sondages.forEach((sondage, index) => {
      const status = sondage.status ? '✅' : '❌';
      console.log(`   ${index + 1}. ${status} ${sondage.question}`);
    });
  }

  /**
   * Charge les questions d'annonce depuis le fichier questions.json
   */
  async loadAnnouncementQuestions() {
    try {
      const data = await fs.readFile('files/questions.json', 'utf8');
      const jsonData = JSON.parse(data);
      return jsonData || { poll: [] };
    } catch (error) {
      console.error('❌ Erreur lors du chargement des questions d\'annonce:', error.message);
      return { poll: [] };
    }
  }

  /**
   * Sauvegarde les questions d'annonce dans le fichier questions.json
   */
  async saveAnnouncementQuestions(questionsData) {
    try {
      await fs.writeFile('files/questions.json', JSON.stringify(questionsData, null, 2), 'utf8');
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde des questions d\'annonce:', error.message);
      throw error;
    }
  }

  /**
   * Récupère les questions d'annonce disponibles (status: true)
   */
  async getAvailableAnnouncementQuestions() {
    const questionsData = await this.loadAnnouncementQuestions();
    return questionsData.poll.filter(question => question.status === true);
  }

  /**
   * Récupère une question aléatoire pour les annonces (seulement celles avec status: true)
   */
  async getRandomAnnouncementQuestion() {
    const availableQuestions = await this.getAvailableAnnouncementQuestions();
    if (availableQuestions.length === 0) {
      return null;
    }
    
    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    return availableQuestions[randomIndex];
  }

  /**
   * Marque une question d'annonce comme utilisée (status: false)
   */
  async markAnnouncementQuestionAsUsed(questionText) {
    try {
      const questionsData = await this.loadAnnouncementQuestions();
      const questionIndex = questionsData.poll.findIndex(q => q.question === questionText);
      
      if (questionIndex >= 0) {
        questionsData.poll[questionIndex].status = false;
        await this.saveAnnouncementQuestions(questionsData);
        console.log(`✅ Question d'annonce "${questionText}" marquée comme utilisée`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Erreur lors du marquage de la question d\'annonce:', error.message);
      return false;
    }
  }

  /**
   * Valide qu'un sondage a au moins 2 réponses
   */
  validateSondage(sondage) {
    if (!sondage.question || sondage.question.trim() === '') {
      return { valid: false, error: 'La question ne peut pas être vide' };
    }
    
    if (!sondage.answers || sondage.answers.length < 2) {
      return { valid: false, error: 'Un sondage doit avoir au moins 2 réponses' };
    }
    
    if (sondage.answers.length > 5) {
      return { valid: false, error: 'Un sondage ne peut pas avoir plus de 5 réponses' };
    }
    
    return { valid: true };
  }

  /**
   * Définit la question d'annonce actuellement affichée
   */
  async setCurrentAnnouncementQuestion(question) {
    this.currentAnnouncementQuestion = question;
    this.announcementStartTime = new Date();
    
    // Sauvegarder dans un fichier pour persistance
    const currentData = {
      question: question,
      startTime: this.announcementStartTime.toISOString(),
      duration: 5 * 60, // 5 minutes en secondes
      isActive: true
    };
    
    try {
      await fs.writeFile('files/current-announcement.json', JSON.stringify(currentData, null, 2), 'utf8');
      console.log(`📢 Question d'annonce définie: "${question}"`);
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde de la question actuelle:', error.message);
    }
  }

  /**
   * Récupère la question d'annonce actuellement affichée
   */
  async getCurrentAnnouncementQuestion() {
    try {
      // Charger depuis le fichier pour avoir la version la plus récente
      const data = await fs.readFile('files/current-announcement.json', 'utf8');
      const currentData = JSON.parse(data);
      
      if (!currentData.isActive) {
        return null;
      }

      const startTime = new Date(currentData.startTime);
      const totalDuration = currentData.duration || (5 * 60); // 5 minutes par défaut

      return {
        question: currentData.question,
        startTime: startTime.toISOString(),
        duration: totalDuration,
        isActive: true
      };
    } catch (error) {
      // Si le fichier n'existe pas ou erreur de lecture, retourner null
      return null;
    }
  }

  /**
   * Efface la question d'annonce actuelle
   */
  async clearCurrentAnnouncementQuestion() {
    this.currentAnnouncementQuestion = null;
    this.announcementStartTime = null;
    
    // Marquer comme inactive dans le fichier
    const currentData = {
      question: null,
      startTime: null,
      isActive: false
    };
    
    try {
      await fs.writeFile('files/current-announcement.json', JSON.stringify(currentData, null, 2), 'utf8');
      console.log('📢 Question d\'annonce effacée');
    } catch (error) {
      console.error('❌ Erreur lors de l\'effacement de la question actuelle:', error.message);
    }
  }

  /**
   * Récupère une question aléatoire et la définit comme question actuelle
   */
  async getAndSetRandomAnnouncementQuestion() {
    const randomQuestion = await this.getRandomAnnouncementQuestion();
    if (randomQuestion) {
      await this.setCurrentAnnouncementQuestion(randomQuestion.question);
      return randomQuestion;
    }
    return null;
  }

  /**
   * Définit le shoutout actuellement affiché
   */
  async setCurrentShoutout(username) {
    this.currentShoutout = username;
    this.shoutoutStartTime = new Date();
    
    // Sauvegarder dans un fichier pour persistance
    const currentData = {
      username: username,
      startTime: this.shoutoutStartTime.toISOString(),
      isActive: true
    };
    
    try {
      await fs.writeFile('files/current-shoutout.json', JSON.stringify(currentData, null, 2), 'utf8');
      console.log(`📢 Shoutout défini: "${username}"`);
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde du shoutout actuel:', error.message);
    }
  }

  /**
   * Récupère le shoutout actuellement affiché
   */
  async getCurrentShoutout() {
    try {
      // Charger depuis le fichier pour avoir la version la plus récente
      const data = await fs.readFile('files/current-shoutout.json', 'utf8');
      const currentData = JSON.parse(data);
      
      if (!currentData.isActive) {
        return null;
      }

      const startTime = new Date(currentData.startTime);
      const duration = Math.floor((new Date() - startTime) / 1000);

      return {
        username: currentData.username,
        startTime: startTime,
        duration: duration,
        isActive: true
      };
    } catch (error) {
      // Si le fichier n'existe pas ou erreur de lecture, retourner null
      return null;
    }
  }

  /**
   * Efface le shoutout actuel
   */
  async clearCurrentShoutout() {
    this.currentShoutout = null;
    this.shoutoutStartTime = null;
    
    // Marquer comme inactive dans le fichier
    const currentData = {
      username: null,
      startTime: null,
      isActive: false
    };
    
    try {
      await fs.writeFile('files/current-shoutout.json', JSON.stringify(currentData, null, 2), 'utf8');
      console.log('📢 Shoutout effacé');
    } catch (error) {
      console.error('❌ Erreur lors de l\'effacement du shoutout actuel:', error.message);
    }
  }
}

export default SondageManager;
