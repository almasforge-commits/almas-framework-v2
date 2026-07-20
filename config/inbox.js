// Inbox feature flags. Safe defaults keep Inbox disabled and unconnected.
// No secrets, no import-time logging, no side effects beyond reading env.

const VALID_MODES = new Set(["off", "shadow"]);

function readBoolean(envVar, fallback) {
  const raw = process.env[envVar];
  if (raw == null || raw === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function readMode() {
  const raw = (process.env.INBOX_MODE ?? "off").trim().toLowerCase();
  return VALID_MODES.has(raw) ? raw : "off";
}

function readPositiveInt(envVar, fallback) {
  const raw = process.env[envVar];
  const parsed = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export const INBOX_ENABLED = readBoolean("INBOX_ENABLED", false);
export const INBOX_MODE = readMode();
export const INBOX_MAX_TEXT_CHARS = readPositiveInt("INBOX_MAX_TEXT_CHARS", 12000);
export const INBOX_LIST_DEFAULT_LIMIT = readPositiveInt("INBOX_LIST_DEFAULT_LIMIT", 50);
export const INBOX_MAX_METADATA_DEPTH = readPositiveInt("INBOX_MAX_METADATA_DEPTH", 5);
export const INBOX_MAX_METADATA_KEYS = readPositiveInt("INBOX_MAX_METADATA_KEYS", 100);

export function isInboxEnabled() {
  return INBOX_ENABLED === true && INBOX_MODE === "shadow";
}

export function getInboxConfig() {
  return {
    enabled: INBOX_ENABLED,
    mode: INBOX_MODE,
    maxTextChars: INBOX_MAX_TEXT_CHARS,
    listDefaultLimit: INBOX_LIST_DEFAULT_LIMIT,
    maxMetadataDepth: INBOX_MAX_METADATA_DEPTH,
    maxMetadataKeys: INBOX_MAX_METADATA_KEYS,
  };
}
