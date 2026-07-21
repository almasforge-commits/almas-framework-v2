import { normalizeCommandText } from "./normalizeUserText.js";

// Exact navigation labels that must never call Tier 1/Tier 2, never
// create Memory/Tasks/Finance, and never produce AI actions. Kept as a
// pure shared list so messageHandler.js, deterministicIntentDetector.js,
// and memoryFilter.js all recognize the same set.

export const MENU_NAVIGATION_COMMANDS = [
  "/start",
  "меню",
  "🏠 главная",
  "📚 знания",
  "💡 идеи",
  "📋 задачи",
  "🚀 проекты",
  "💰 финансы",
  "🧠 память",
  "🌐 открыть almas",
  "❓ как пользоваться",
  "❓ помощь",
];

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isMenuNavigationCommand(text) {
  return MENU_NAVIGATION_COMMANDS.includes(normalizeCommandText(text));
}
