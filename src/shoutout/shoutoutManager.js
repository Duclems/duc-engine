import fs from 'fs/promises';

class ShoutoutManager {
  constructor() {
    this.currentShoutout = null;
    this.shoutoutStartTime = null;
  }

  async setCurrentShoutout(username) {
    this.currentShoutout = username;
    this.shoutoutStartTime = new Date();

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

  async getCurrentShoutout() {
    try {
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
    } catch {
      return null;
    }
  }

  async clearCurrentShoutout() {
    this.currentShoutout = null;
    this.shoutoutStartTime = null;

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

export default ShoutoutManager;

