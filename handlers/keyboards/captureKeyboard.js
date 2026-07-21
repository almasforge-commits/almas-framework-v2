/**
 * Inline keyboard for Capture Session — thin Telegram UX.
 * Detail review opens in Mini App when ALMAS_WEB_APP_URL is set.
 */

import { CAPTURE_CALLBACK } from "../../services/capture/captureContracts.js";
import {
  buildMiniAppWebAppButton,
  capturePath,
  THIN_CONFIRM,
} from "../../config/deepLinks.js";

/**
 * @param {object} [opts]
 * @param {string|null} [opts.sessionId]
 * @returns {{ reply_markup: object }}
 */
export function buildCaptureConfirmKeyboard(opts = {}) {
  const rows = [];

  const review = opts.sessionId
    ? buildMiniAppWebAppButton(THIN_CONFIRM.review, capturePath(opts.sessionId))
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
