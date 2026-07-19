import { askAI } from "../../providers/ai/openaiProvider.js";

const MAX_CONTEXT_ITEMS = 5;

function buildContext(knowledge) {

  return knowledge
    .slice(0, MAX_CONTEXT_ITEMS)
    .map((item, index) => {

      const keyPoints = (item.keyPoints ?? [])
        .map(point => `- ${point}`)
        .join("\n");

      const ideas = (item.ideas ?? [])
        .map(idea => `- ${idea}`)
        .join("\n");

      const tasks = (item.tasks ?? [])
        .map(task => `- ${task}`)
        .join("\n");

      return `
# Источник ${index + 1}

Название:
${item.title}

Краткое содержание:
${item.summary}

Основные мысли:
${keyPoints || "Нет"}

Идеи:
${ideas || "Нет"}

Практические действия:
${tasks || "Нет"}
`;
    })
    .join("\n\n==============================\n\n");

}

export async function askKnowledge(question, knowledge) {

  if (!question?.trim()) {

    return null;

  }

  if (!knowledge?.length) {

    return {

      answer:
        "Я не нашёл подходящих знаний в своей базе, чтобы уверенно ответить на этот вопрос.",

      sources: [],

    };

  }

  const systemPrompt = `
Ты — ALMAS AI, персональный ассистент по знаниям.

Правила:

- Используй ТОЛЬКО предоставленные материалы.
- Никогда не выдумывай информацию.
- Если данных недостаточно — честно скажи об этом.
- Не перечисляй подряд Summary, Ideas и Tasks.
- Объединяй информацию из разных источников в единый логичный ответ.
- Отвечай как эксперт, а не как поисковик.
- Не упоминай ID знаний.
- В конце верни только названия реально использованных источников.
- Если несколько источников говорят одно и то же — объедини их.
- Не повторяй одинаковые мысли.
- Если вопрос предполагает совет — сформулируй его на основе найденных знаний.

Стиль:

- естественный русский язык;
- короткие абзацы;
- без канцелярита;
- если уместно — используй маркированный список;
- не используй заголовки "Summary", "Ideas", "Tasks".

`;

  const userPrompt = `
Вопрос пользователя:

${question}

==================================

Доступные знания:

${buildContext(knowledge)}
`;

  const schema = {

    name: "knowledge_answer",

    schema: {

      type: "object",

      additionalProperties: false,

      properties: {

        answer: {
          type: "string"
        },

        sources: {

          type: "array",

          items: {
            type: "string"
          }

        }

      },

      required: [
        "answer",
        "sources"
      ]

    }

  };

  const result = await askAI(
    systemPrompt,
    userPrompt,
    schema
  );

  if (!result) {

    return {

      answer: "Не удалось сформировать ответ.",

      sources: [],

    };

  }

  const availableTitles = new Set(
    knowledge.map(item => item.title)
  );

  result.sources = (result.sources ?? []).filter(title =>
    availableTitles.has(title)
  );

  return result;

}