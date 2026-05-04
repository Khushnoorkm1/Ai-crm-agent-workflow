/**
 * Telegram Bot Service
 * Handles Telegram bot interactions and messaging
 */

const TelegramBot = require('node-telegram-bot-api');

class TelegramBotService {
  constructor(token) {
    this.token = token;
    this.bot = new TelegramBot(token, { polling: true });
    this.setupHandlers();
  }

  setupHandlers() {
    // Handle /start command
    this.bot.onText(/\/start/, (msg) => {
      this.handleStart(msg);
    });

    // Handle regular messages
    this.bot.on('message', (msg) => {
      this.handleMessage(msg);
    });
  }

  handleStart(msg) {
    const chatId = msg.chat.id;
    const welcomeMessage = 'Welcome to CRM Agent Bot! How can I help you today?';
    this.bot.sendMessage(chatId, welcomeMessage);
  }

  handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    // Process message and send response
    this.bot.sendMessage(chatId, `Received: ${text}`);
  }

  sendMessage(chatId, message) {
    return this.bot.sendMessage(chatId, message);
  }

  close() {
    this.bot.stopPolling();
  }
}

module.exports = TelegramBotService;
