// Backward-compatible re-export. The implementation now lives in the
// shared core/utils/normalizeUserText.js, which also exports the lighter
// normalizeUserText() helper. Kept as a separate module so existing
// imports (handlers/messageHandler.js, existing tests) keep working
// unchanged.
export { normalizeCommandText } from "./normalizeUserText.js";
