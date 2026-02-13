const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class CryptoService {
  generateUUID() {
    return uuidv4();
  }

  generatePassword(length = 16) {
    return crypto.randomBytes(length).toString('base64').slice(0, length);
  }

  generateSubscriptionToken() {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = new CryptoService();
