/**
 * Inline keyboard for Capture Session — thin Telegram UX.
 * Detail review opens via web_app (never plain url) when ALMAS_WEB_APP_URL is set.
 */

import { CAPTURE_CALLBACK } from "../../services/capture/captureContracts.js";
import {
  createMiniAppButton,
  capturePath,
  THIN_CONFIRM,
} from "../../config/deepLinks.js";

/**
 * @param {object} [opts]
 * @param {string|null} [opts.sessionId]
 * @param {string|null} [opts.baseUrl]
 * @returns {{ reply_markup: object }}
 */
export function buildCaptureConfirmKeyboard(opts = {}) {
  const rows = [];

  const review = opts.sessionId
    ? createMiniAppButton({
        text: THIN_CONFIRM.review,
        path: capturePath(opts.sessionId),
        baseUrl: opts.baseUrl,
      })
    : null;
  if (review) {
    rows.push([review]);
  }

  rows.push([
    { text: "✅ Confirm →", callback_data: CAPTURE_CALLBACK.confirm },
    { text: "❌ Отмена", callback_data: CAPTURE_CALLBACK.cancel },
  ]);

  return { reply_markup: { inline_keyboard: rows } };
}
