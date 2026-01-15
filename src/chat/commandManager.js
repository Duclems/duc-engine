import fs from 'fs/promises';

class CommandManager {
  constructor(commandsFilePath = 'files/commands.json') {
    this.commandsFilePath = commandsFilePath;
    this.commands = { global: {}, moderator: {} };
    this.lastModified = 0;
  }

  /**
   * Charge les commandes depuis le fichier JSON
   */
  async loadCommands() {
    try {
      const data = await fs.readFile(this.commandsFilePath, 'utf8');
      const jsonData = JSON.parse(data);
      this.commands = jsonData.commands || { global: {}, moderator: {} };
      console.log(`📋 Commandes chargées: ${Object.keys(this.commands.global || {}).length} globales, ${Object.keys(this.commands.moderator || {}).length} modérateur`);
      return this.commands;
    } catch (error) {
      console.error('❌ Erreur lors du chargement des commandes:', error.message);
      return { global: {}, moderator: {} };
    }
  }

  /**
   * Vérifie si le fichier a été modifié et recharge si nécessaire
   */
  async checkAndReloadIfNeeded() {
    try {
      const stats = await fs.stat(this.commandsFilePath);
      const currentModified = stats.mtime.getTime();
      
      if (currentModified > this.lastModified) {
        this.lastModified = currentModified;
        await this.loadCommands();
        return true; // Fichier rechargé
      }
      return false; // Pas de changement
    } catch (error) {
      console.error('❌ Erreur lors de la vérification du fichier commands.json:', error.message);
      return false;
    }
  }

  /**
   * Trouve une commande (insensible à la casse)
   */
  findCommand(commandName, isModerator = false) {
    console.log(`🔍 Recherche commande: "${commandName}" (isModerator: ${isModerator})`);
    
    // Recherche insensible à la casse
    const lowerCommandName = commandName.toLowerCase();
    
    // D'abord chercher dans les commandes globales
    const globalCommands = this.commands.global || {};
    console.log(`📋 Commandes globales disponibles:`, Object.keys(globalCommands));
    
    for (const [key, value] of Object.entries(globalCommands)) {
      if (key.toLowerCase() === lowerCommandName) {
        console.log(`✅ Commande globale trouvée: ${key}`);
        return value;
      }
    }
    
    // Si c'est un modérateur, chercher aussi dans les commandes modérateur
    if (isModerator) {
      const moderatorCommands = this.commands.moderator || {};
      console.log(`📋 Commandes modérateur disponibles:`, Object.keys(moderatorCommands));
      
      for (const [key, value] of Object.entries(moderatorCommands)) {
        if (key.toLowerCase() === lowerCommandName) {
          console.log(`✅ Commande modérateur trouvée: ${key}`);
          return value;
        }
      }
    }
    
    console.log(`❌ Commande "${commandName}" non trouvée`);
    return null;
  }

  /**
   * Ajoute une nouvelle commande
   */
  async addCommand(commandName, response, description = '', isModerator = false) {
    const commandType = isModerator ? 'moderator' : 'global';
    
    this.commands[commandType][commandName] = {
      response: response,
      description: description
    };
    
    await this.saveCommands();
    console.log(`✅ Commande !${commandName} ajoutée (${isModerator ? 'modérateur' : 'globale'})`);
  }

  /**
   * Supprime une commande
   */
  async removeCommand(commandName, isModerator = false) {
    const commandType = isModerator ? 'moderator' : 'global';
    
    if (this.commands[commandType][commandName]) {
      delete this.commands[commandType][commandName];
      await this.saveCommands();
      console.log(`🗑️ Commande !${commandName} supprimée (${isModerator ? 'modérateur' : 'globale'})`);
      return true;
    }
    
    return false;
  }

  /**
   * Sauvegarde les commandes dans le fichier JSON
   */
  async saveCommands() {
    try {
      const data = {
        commands: this.commands
      };
      await fs.writeFile(this.commandsFilePath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde des commandes:', error.message);
      return false;
    }
  }

  /**
   * Affiche toutes les commandes
   */
  displayCommands() {
    console.log('\n📋 Commandes disponibles:');
    
    console.log('\n🌍 Commandes globales:');
    const globalCommands = this.commands.global || {};
    if (Object.keys(globalCommands).length === 0) {
      console.log('   Aucune commande globale');
    } else {
      for (const [name, command] of Object.entries(globalCommands)) {
        console.log(`   !${name}: ${command.description || 'Pas de description'}`);
      }
    }
    
    console.log('\n👮 Commandes modérateur:');
    const moderatorCommands = this.commands.moderator || {};
    if (Object.keys(moderatorCommands).length === 0) {
      console.log('   Aucune commande modérateur');
    } else {
      for (const [name, command] of Object.entries(moderatorCommands)) {
        console.log(`   !${name}: ${command.description || 'Pas de description'}`);
      }
    }
  }
}

export default CommandManager;
