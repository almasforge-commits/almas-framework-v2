import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { transcribeAudio } from "../../services/ai/transcriptionService.js";
import { isPlausibleRussianTranscript } from "../../core/utils/validateVoiceTranscript.js";
import { normalizeUserText } from "../../core/utils/normalizeUserText.js";

export const MAX_VOICE_DURATION_SECONDS = 120;
export const MAX_VOICE_FILE_SIZE_BYTES = 15 * 1024 * 1024;

const DURATION_ERROR = "❌ Голосовое сообщение слишком длинное (максимум 2 минуты).";
const SIZE_ERROR = "❌ Голосовое сообщение слишком большое (максимум 15 МБ).";
const DOWNLOAD_ERROR = "❌ Не удалось загрузить голосовое сообщение. Попробуйте позже.";
const TRANSCRIBE_ERROR = "❌ Не удалось распознать речь. Попробуйте ещё раз или отправьте текст.";
const LOW_CONFIDENCE_ERROR = "❌ Не удалось уверенно распознать речь. Попробуйте сказать ещё раз.";

// Importing config/bot.js constructs a real, polling TelegramBot as a
// module-level side effect. Deferring the import until a real (non-test)
// call actually needs it keeps isolated tests (which always inject every
// dependency below) from ever touching the real Telegram client.
let botPromise = null;

function getBot() {
  if (!botPromise) {
    botPromise = import("../../config/bot.js").then((mod) => mod.default);
  }
  return botPromise;
}

async function defaultDownload(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download voice file: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Handles an incoming Telegram voice message: validates size/duration,
 * downloads it to a temp file, transcribes it, sends the recognized text
 * back to the user, and always cleans up the temp file.
 *
 * Phase 1 only: does NOT route the recognized text into Finance, Tasks,
 * Memory, Chat, or commands. That is Phase 2.
 *
 * @param {number|string} chatId
 * @param {object} voice - msg.voice from node-telegram-bot-api
 *   ({ file_id, duration, file_size, ... }).
 * @param {object} [options] - Dependency injection for isolated tests.
 * @returns {Promise<string|null>} The recognized text, or null if the
 *   message was rejected or transcription failed (an error message has
 *   already been sent to the user in that case).
 */
export async function handleVoiceMessage(chatId, voice, options = {}) {
  const {
    getFileLinkFn = async (fileId) => (await getBot()).getFileLink(fileId),
    downloadFn = defaultDownload,
    writeFileFn = fs.promises.writeFile,
    unlinkFn = fs.promises.unlink,
    transcribeFn = transcribeAudio,
    sendMessageFn = async (id, text) => (await getBot()).sendMessage(id, text),
    tmpDir = os.tmpdir(),
    randomIdFn = () => crypto.randomUUID(),
    isPlausibleTranscriptFn = isPlausibleRussianTranscript,
  } = options;

  if (!voice || !voice.file_id) {
    return null;
  }

  if (voice.duration != null && voice.duration > MAX_VOICE_DURATION_SECONDS) {
    await sendMessageFn(chatId, DURATION_ERROR);
    return null;
  }

  if (voice.file_size != null && voice.file_size > MAX_VOICE_FILE_SIZE_BYTES) {
    await sendMessageFn(chatId, SIZE_ERROR);
    return null;
  }

  const tempPath = path.join(tmpDir, `almas-voice-${randomIdFn()}.ogg`);
  let downloaded = false;

  try {

    let fileUrl;

    try {
      fileUrl = await getFileLinkFn(voice.file_id);
    } catch (error) {
      console.error("Ошибка получения ссылки на голосовое сообщение:", error);
      await sendMessageFn(chatId, DOWNLOAD_ERROR);
      return null;
    }

    let buffer;

    try {
      buffer = await downloadFn(fileUrl);
    } catch (error) {
      console.error("Ошибка загрузки голосового сообщения:", error);
      await sendMessageFn(chatId, DOWNLOAD_ERROR);
      return null;
    }

    // Re-check actual size — Telegram doesn't always populate file_size
    // up front, so the pre-download check above is a best-effort guard.
    if (!buffer || buffer.length > MAX_VOICE_FILE_SIZE_BYTES) {
      await sendMessageFn(chatId, SIZE_ERROR);
      return null;
    }

    await writeFileFn(tempPath, buffer);
    downloaded = true;

    let text;

    try {
      text = await transcribeFn(tempPath);
    } catch (error) {
      console.error("Ошибка распознавания голосового сообщения:", error);
      await sendMessageFn(chatId, TRANSCRIBE_ERROR);
      return null;
    }

    if (!text) {
      await sendMessageFn(chatId, TRANSCRIBE_ERROR);
      return null;
    }

    // Light normalization only (collapse whitespace/repeated
    // punctuation) — case and (non-repeated) punctuation are preserved
    // since routeText()'s own normalization (for command matching) and
    // finance/knowledge parsing need the original content.
    const normalizedTranscript = normalizeUserText(text);

    if (!normalizedTranscript || !isPlausibleTranscriptFn(normalizedTranscript)) {
      await sendMessageFn(chatId, LOW_CONFIDENCE_ERROR);
      return null;
    }

    await sendMessageFn(chatId, `🎙 Распознано:\n\n${normalizedTranscript}`);

    return normalizedTranscript;

  } finally {

    if (downloaded) {
      try {
        await unlinkFn(tempPath);
      } catch (error) {
        console.error(
          "Не удалось удалить временный файл голосового сообщения:",
          error
        );
      }
    }

  }

}
