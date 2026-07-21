import TelegramBot from "node-telegram-bot-api";
import { attachPersistentMainKeyboard } from "../handlers/keyboards/mainMenu.js";

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

// Restore the thin-inbox reply keyboard on every plain text reply
// (skipped when the message already uses inline_keyboard or keyboard).
const originalSendMessage = bot.sendMessage.bind(bot);
bot.sendMessage = function sendMessageWithPersistentKeyboard(
  chatId,
  text,
  options = {}
) {
  return originalSendMessage(chatId, text, attachPersistentMainKeyboard(options));
};

export default bot;
