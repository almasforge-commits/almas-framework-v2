import bot from "../../config/bot.js";

import { runYouTubeWorkflow } from "../../services/workflows/youtubeWorkflow.js";
import { saveKnowledge } from "../../services/storage/knowledgeService.js";

export async function handleYouTube(chatId, url) {

  await bot.sendMessage(chatId, "🧠 Анализирую видео...");

  const result = await runYouTubeWorkflow(url);

  if (!result.success) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${result.error}`);
    return true;
  }

  let saved;

  try {
    saved = await saveKnowledge(result.knowledge);
  } catch (error) {
    console.error("Ошибка сохранения знания:", error);
    await bot.sendMessage(chatId, "❌ Не удалось сохранить знание. Попробуйте позже.");
    return true;
  }

  const knowledge = saved.knowledge;

  // Если знание уже существовало — не засоряем чат
  if (saved.updated) {

    await bot.sendMessage(
      chatId,
`♻️ Знание обновлено

📺 ${knowledge.title}

Обновлены:
• краткое содержание
• основные мысли
• идеи
• задачи`
    );

    return true;
  }

  // Новое знание — показываем полный анализ
  const keyPoints = knowledge.keyPoints.map(p => `• ${p}`).join("\n");

  const ideas = knowledge.ideas.length
    ? knowledge.ideas.map(i => `• ${i}`).join("\n")
    : "Нет";

  const tasks = knowledge.tasks.length
    ? knowledge.tasks.map(t => `• ${t}`).join("\n")
    : "Нет";

  const tags = knowledge.tags.length
    ? knowledge.tags.map(t => `#${t}`).join(" ")
    : "Нет";

  await bot.sendMessage(
    chatId,
`✅ Новое знание сохранено

📺 ${knowledge.title}

━━━━━━━━━━━━━━

📝 ${knowledge.summary}

━━━━━━━━━━━━━━

💡 Основные мысли

${keyPoints}

━━━━━━━━━━━━━━

🏷️ Теги

${tags}

━━━━━━━━━━━━━━

🚀 Идеи

${ideas}

━━━━━━━━━━━━━━

✅ Задачи

${tasks}`
  );

  return true;

}