import fs from 'fs/promises';

class BirthdayManager {
  constructor(filePath = 'files/birthdays.json') {
    this.filePath = filePath;
    this.birthdays = {};
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return this.birthdays;
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      this.birthdays = JSON.parse(data) || {};
    } catch {
      this.birthdays = {};
    }
    this.loaded = true;
    return this.birthdays;
  }

  async save() {
    await fs.writeFile(this.filePath, JSON.stringify(this.birthdays, null, 2), 'utf8');
  }

  async getBirthday(usernameKey) {
    await this.load();
    return this.birthdays[usernameKey] || null;
  }

  async setBirthday(usernameKey, record) {
    await this.load();
    this.birthdays[usernameKey] = record;
    await this.save();
  }
}

export default BirthdayManager;

