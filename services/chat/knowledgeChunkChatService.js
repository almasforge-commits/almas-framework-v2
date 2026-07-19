import { createEmbedding } from "../ai/embeddingService.js";
import { searchKnowledgeChunks } from "../storage/knowledgeChunkService.js";

const DEFAULT_MATCH_THRESHOLD = 0.3;
const DEFAULT_MATCH_COUNT = 8;

// chatService.js (whole-document RAG) is intentionally left unchanged and
// untouched by this file. Every failure path below returns null, which
// callers treat uniformly as "fall back to the existing implementation."

async function defaultAskAI(...args) {
  // Dynamic import: providers/ai/openaiProvider.js constructs its OpenAI
  // client eagerly at module-import time, which throws if OPENAI_API_KEY
  // is missing. Importing it lazily keeps this module (and its tests)
  // safe to load with no API key present.
  const { askAI } = await import("../../providers/ai/openaiProvider.js");
  return askAI(...args);
}

function logFallback(reason, error) {
  if (error) {
    console.warn(`[askKnowledgeChunks] fallback (${reason}): ${error.message}`);
  } else {
    console.warn(`[askKnowledgeChunks] fallback (${reason})`);
  }
}

function buildContext(chunks) {

  return chunks
    .map((chunk, index) => `
# Фрагмент ${index + 1} — ${chunk.knowledgeTitle ?? "Без названия"}

${chunk.content}
`)
    .join("\n\n==============================\n\n");

}

const SYSTEM_PROMPT = `
Ты — ALMAS AI, персональный ассистент по знаниям.

Тебе передают не целые документы, а отдельные фрагменты (excerpts) из них.

Правила:

- Используй ТОЛЬКО предоставленные фрагменты.
- Никогда не выдумывай информацию.
- Если фрагментов недостаточно для уверенного ответа — честно скажи об этом.
- Объединяй информацию из разных фрагментов в единый логичный ответ.
- Отвечай как эксперт, а не как поисковик.
- Не упоминай ID знаний или номера фрагментов.
- В конце верни только названия реально использованных источников.
- Если несколько фрагментов говорят одно и то же — объедини их.
- Не повторяй одинаковые мысли.

Стиль:

- естественный русский язык;
- короткие абзацы;
- без канцелярита;
- если уместно — используй маркированный список.
`;

const ANSWER_SCHEMA = {
  name: "knowledge_chunk_answer",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      sources: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["answer", "sources"],
  },
};

/**
 * Chunk-based RAG over knowledge_chunks. Returns null on ANY failure
 * (embedding, chunk search, or the AI call itself) or when no chunks are
 * found — callers should treat null uniformly as "fall back to the
 * existing whole-document implementation."
 *
 * @param {string} question
 * @param {{ createEmbeddingFn?: Function, searchKnowledgeChunksFn?: Function, askAIFn?: Function, matchThreshold?: number, matchCount?: number }} options
 * @returns {Promise<{ answer: string, sources: string[] } | null>}
 */
export async function askKnowledgeChunks(question, options = {}) {

  const {
    createEmbeddingFn = createEmbedding,
    searchKnowledgeChunksFn = searchKnowledgeChunks,
    askAIFn = defaultAskAI,
    matchThreshold = DEFAULT_MATCH_THRESHOLD,
    matchCount = DEFAULT_MATCH_COUNT,
  } = options;

  if (!question?.trim()) {
    return null;
  }

  let embedding;
  try {
    embedding = await createEmbeddingFn(question);
  } catch (error) {
    logFallback("embedding failure", error);
    return null;
  }

  if (!embedding) {
    logFallback("embedding failure");
    return null;
  }

  let chunks;
  try {
    chunks = await searchKnowledgeChunksFn(embedding, { matchThreshold, matchCount });
  } catch (error) {
    logFallback("chunk search failure", error);
    return null;
  }

  if (!chunks?.length) {
    logFallback("no chunks");
    return null;
  }

  const userPrompt = `
Вопрос пользователя:

${question}

==================================

Найденные фрагменты знаний:

${buildContext(chunks)}
`;

  let result;
  try {
    result = await askAIFn(SYSTEM_PROMPT, userPrompt, ANSWER_SCHEMA);
  } catch (error) {
    logFallback("AI answer failure", error);
    return null;
  }

  if (!result?.answer) {
    logFallback("AI answer failure");
    return null;
  }

  const availableTitles = new Set(
    chunks.map((chunk) => chunk.knowledgeTitle).filter(Boolean)
  );

  const sources = Array.from(new Set(
    (result.sources ?? []).filter((title) => availableTitles.has(title))
  ));

  return {
    answer: result.answer,
    sources,
  };

}
