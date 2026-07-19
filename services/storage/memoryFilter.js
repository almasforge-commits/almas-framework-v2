import { isYouTubeLink } from "../content/youtubeService.js";

export function shouldSaveMemory(text) {
  const value = text.toLowerCase().trim();

  if (value === "привет") return false;
  if (value === "мои знания") return false;
  if (value === "удалить все знания") return false;

  if (value.startsWith("найди ")) return false;
  if (value.startsWith("спроси ")) return false;
  if (value.startsWith("открыть ")) return false;
  if (value.startsWith("покажи ")) return false;
  if (value.startsWith("вспомни ")) return false;
  if (value.startsWith("добавь ")) return false;
  if (value.startsWith("подумай ")) return false;
  if (value.startsWith("как думаешь")) return false;
  
  if (isYouTubeLink(text)) return false;

  return true;
}