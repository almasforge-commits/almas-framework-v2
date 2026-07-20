// Configuration for the hybrid AI Intent Analyzer / Action Planner
// ("AI router"). Every value is env-driven with a safe default so the
// router can be tuned or fully disabled without a code change. No
// secrets live here — only model names, thresholds, and mode flags.

const VALID_MODES = new Set(["off", "shadow", "active"]);

function readMode() {
  const raw = (process.env.AI_ROUTER_MODE ?? "shadow").trim().toLowerCase();
  return VALID_MODES.has(raw) ? raw : "shadow";
}

function readBoolean(envVar, fallback) {
  const raw = process.env[envVar];
  if (raw == null || raw === "") return fallback;
  return raw.trim().toLowerCase() !== "false";
}

function readNumber(envVar, fallback) {
  const raw = process.env[envVar];
  const parsed = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(parsed) ? parsed : fallback;
}

// Kill switch: when false, the router never runs at all (equivalent to
// mode "off"), regardless of AI_ROUTER_MODE.
export const AI_ROUTER_ENABLED = readBoolean("AI_ROUTER_ENABLED", true);

// off    -> router never runs.
// shadow -> router runs and logs its decision, never executes anything.
//           This is the safe default (AI_ROUTER_MODE stays "shadow" in .env).
// active -> router runs and may execute only task_create / memory_save
//           through actionExecutor.js. messageHandler.js then AWAITS the
//           decision before legacy side effects (see isAiRouterExecutionActive).
//           Do not flip .env to "active" without an explicit, separate decision.
export const AI_ROUTER_MODE = readMode();

export const AI_ROUTER_CHEAP_MODEL = process.env.AI_ROUTER_CHEAP_MODEL || "gpt-5-nano";
export const AI_ROUTER_MEDIUM_MODEL = process.env.AI_ROUTER_MEDIUM_MODEL || "gpt-5-mini";

export const AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD = readNumber(
  "AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD",
  0.85
);

export const AI_ROUTER_MAX_INPUT_CHARS = readNumber("AI_ROUTER_MAX_INPUT_CHARS", 6000);
export const AI_ROUTER_MAX_ACTIONS = readNumber("AI_ROUTER_MAX_ACTIONS", 5);

export function isAiRouterActive() {
  return AI_ROUTER_ENABLED && AI_ROUTER_MODE !== "off";
}

// Narrower than isAiRouterActive(): true only when the router is allowed
// to actually execute (task_create/memory_save) and messageHandler.js
// must therefore AWAIT decideRouting() before any legacy side effect,
// instead of the default fire-and-forget shadow observation. Shadow mode
// (the default) and "off" both return false here.
export function isAiRouterExecutionActive() {
  return AI_ROUTER_ENABLED && AI_ROUTER_MODE === "active";
}

export function getAiRouterConfig() {
  return {
    enabled: AI_ROUTER_ENABLED,
    mode: AI_ROUTER_MODE,
    cheapModel: AI_ROUTER_CHEAP_MODEL,
    mediumModel: AI_ROUTER_MEDIUM_MODEL,
    cheapConfidenceThreshold: AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD,
    maxInputChars: AI_ROUTER_MAX_INPUT_CHARS,
    maxActions: AI_ROUTER_MAX_ACTIONS,
  };
}
