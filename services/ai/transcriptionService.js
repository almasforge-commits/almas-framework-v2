import fs from "node:fs";
import OpenAI from "openai";

// Configurable via environment, never hardcoded elsewhere. No cost
// assumptions are encoded here — model choice only.
const DEFAULT_TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1";

// ALMAS is Russian-only today. Requesting the language explicitly (ISO
// 639-1) improves accuracy and reduces the chance of the model
// transcribing into an unrelated script/language.
const DEFAULT_TRANSCRIPTION_LANGUAGE =
  process.env.OPENAI_TRANSCRIPTION_LANGUAGE || "ru";

// Lazily constructed, same pattern as embeddingService.js: constructing the
// OpenAI SDK client throws immediately if OPENAI_API_KEY is missing, so we
// defer construction until first real use. Tests never reach this because
// they always inject createTranscriptionFn.
let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return client;
}

/**
 * Transcribes an audio file to text via OpenAI.
 *
 * @param {string} filePath - Absolute path to a local audio file.
 * @param {object} [options]
 * @param {string} [options.model] - Overrides DEFAULT_TRANSCRIPTION_MODEL.
 * @param {string} [options.language] - Overrides DEFAULT_TRANSCRIPTION_LANGUAGE
 *   (ISO 639-1, e.g. "ru"). Pass "" explicitly to omit the language hint.
 * @param {Function} [options.createTranscriptionFn] - Injected for tests;
 *   receives the same params object normally passed to
 *   openai.audio.transcriptions.create(). Never calls the real OpenAI API
 *   when provided.
 * @param {Function} [options.createReadStreamFn] - Injected for tests;
 *   defaults to fs.createReadStream. Called with `filePath`.
 * @returns {Promise<string|null>} Trimmed transcript text, or null if the
 *   result was empty/whitespace-only.
 */
export async function transcribeAudio(filePath, options = {}) {
  const {
    model = DEFAULT_TRANSCRIPTION_MODEL,
    language = DEFAULT_TRANSCRIPTION_LANGUAGE,
    createTranscriptionFn,
    createReadStreamFn = fs.createReadStream,
  } = options;

  if (!filePath || typeof filePath !== "string") {
    throw new Error("transcribeAudio: filePath is required and must be a string.");
  }

  const transcribe =
    createTranscriptionFn ??
    ((params) => getClient().audio.transcriptions.create(params));

  const params = {
    file: createReadStreamFn(filePath),
    model,
  };

  if (language) {
    params.language = language;
  }

  let response;

  try {
    response = await transcribe(params);
  } catch (error) {
    throw new Error(
      `transcribeAudio failed (model=${model}): ${error.message}`
    );
  }

  const text = response?.text?.trim();

  return text ? text : null;
}
