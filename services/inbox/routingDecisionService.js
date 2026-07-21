import {
  AI_ROUTER_ENABLED,
  AI_ROUTER_MODE,
  AI_ROUTER_CHEAP_MODEL,
  AI_ROUTER_MEDIUM_MODEL,
  AI_ROUTER_MAX_INPUT_CHARS,
  AI_ROUTER_MAX_ACTIONS,
  AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD,
} from "../../config/aiRouter.js";
import { normalizeForRouting } from "./inputNormalizer.js";
import { detectDeterministicIntent } from "./deterministicIntentDetector.js";
import { analyzeIntent } from "./aiIntentAnalyzer.js";
import { shouldEscalateToMediumTier, planWithMediumTier } from "./actionPlanner.js";
import { validateRoutingContract } from "./actionValidator.js";
import { normalizeRoutingContract } from "./contracts.js";
import { createOpenAiPlannerProvider } from "../../providers/ai/openaiPlannerProvider.js";
import { executeActions } from "./actionExecutor.js";
import {
  queueInboxDecisionObservation,
  queueInboxFailure,
} from "./inboxObservation.js";

// Top-level orchestrator for the hybrid AI router. This is the ONLY
// module handlers/messageHandler.js talks to. It ties together:
// normalize -> Tier 0 (deterministic) -> Tier 1 (cheap AI) ->
// escalation decision -> Tier 2 (medium AI) -> Safety Validator ->
// Action Executor.
//
// IMPORTANT — safety boundary: this file does not import, and must
// never import, Telegram/Supabase/Finance/Memory/Tasks/Knowledge
// directly. The only module allowed to call a domain-executing service
// is actionExecutor.js, and only for actions actionValidator.js has
// already approved. Even then, execution only actually happens when
// AI_ROUTER_MODE=active AND the action's type is in
// actionExecutor.js's EXECUTABLE_ACTION_TYPES (currently task_create
// and memory_save only) — everything else is always recorded as
// skipped, never executed. See docs/PROJECT_STATE.md.

let lazyDefaultProvider = null;

function getDefaultProvider() {
  if (!lazyDefaultProvider) {
    lazyDefaultProvider = createOpenAiPlannerProvider();
  }
  return lazyDefaultProvider;
}

function sanitizedPreview(text, maxLen = 40) {
  const value = String(text ?? "");
  return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
}

/**
 * Aggregates skip reason codes from execution results into a compact,
 * content-free summary for the sanitized ai-router log
 * (e.g. "skipped_missing_task_content:1,skipped_finance_not_enabled:1").
 *
 * @param {object[]} execution
 * @returns {string}
 */
export function summarizeSkippedReasons(execution) {
  const counts = Object.create(null);

  for (const result of Array.isArray(execution) ? execution : []) {
    if (result?.executed === true) continue;
    const reason =
      typeof result?.reason === "string" && result.reason.trim()
        ? result.reason
        : "unknown";
    counts[reason] = (counts[reason] || 0) + 1;
  }

  const parts = Object.keys(counts)
    .sort()
    .map((reason) => `${reason}:${counts[reason]}`);

  return parts.length ? parts.join(",") : "none";
}

function logDecision(decision) {
  // Sanitized: only a short preview of the input, never the full
  // message content, and never any secret/config value. Skip reasons
  // are aggregated as reason-code counts only.
  console.log(
    `[ai-router] mode=${decision.mode} tier=${decision.tier} lang=${decision.language} ` +
      `actions=${decision.actions.length} rejected=${decision.rejectedActions.length} ` +
      `needsClarification=${decision.needsClarification} wouldExecute=${decision.wouldExecute} ` +
      `executed=${decision.executedCount} skipped=${decision.skippedCount} ` +
      `skippedReasons=${decision.skippedReasons} ` +
      `reason=${decision.reasonCode} escalated=${decision.escalated} inputSource=${decision.inputSource} ` +
      `latencyMs=${decision.timings.totalMs} preview="${decision.inputPreview}"`
  );
}

/**
 * Runs the full hybrid pipeline for one message and returns a decision.
 * Actions only ever actually execute through actionExecutor.js, only in
 * "active" mode, and only for its whitelisted action types — see
 * module-level comment.
 *
 * @param {string} rawText
 * @param {object} [context]
 * @param {"text"|"voice"} [context.inputSource]
 * @param {number|string} [context.chatId] - forwarded to the executor for Memory/Task metadata only.
 * @param {{ id?, username?, first_name? }} [context.from] - Telegram msg.from, forwarded the same way.
 * @param {string|null} [context.requestKey] - forwarded to the executor for cross-call idempotency (see core/utils/buildRequestKey.js / actionExecutor.js).
 * @param {string|null} [context.sourceType] - Inbox source type (telegram_text|telegram_voice); audit only.
 * @param {string|null} [context.normalizedText] - Inbox normalized text; audit only.
 * @param {object|null} [context.actor] - Inbox actor; audit only, unused by routing.
 * @param {import("../../providers/ai/plannerProvider.js").PlannerProvider} [context.provider] - injected for tests; defaults to the real OpenAI-backed provider.
 * @param {object} [context.configOverrides] - injected for tests only.
 * @param {Function} [context.executeActionsFn] - injected for tests; defaults to the real executeActions.
 * @param {object} [context.executorDeps] - injected for tests; forwarded to executeActionsFn's deps param.
 * @param {object} [context.inboxDeps] - injected for tests; forwarded to Inbox observation helpers.
 * @returns {Promise<object|{ skipped: true, reason: string }>}
 */
export async function decideRouting(rawText, context = {}) {
  const startedAt = Date.now();

  const {
    inputSource = "text",
    chatId = null,
    from = null,
    requestKey = null,
    sourceType = null,
    normalizedText = null,
    originalText = null,
    actor = null,
    provider,
    configOverrides = {},
    executeActionsFn = executeActions,
    executorDeps = {},
    inboxDeps = {},
  } = context;

  const inboxContext = {
    sourceType,
    normalizedText: normalizedText ?? "",
    originalText: originalText ?? rawText ?? "",
    inputSource,
    actor,
  };

  try {
    const enabled = configOverrides.enabled ?? AI_ROUTER_ENABLED;
    const mode = configOverrides.mode ?? AI_ROUTER_MODE;

    if (!enabled || mode === "off") {
      const skipped = { skipped: true, reason: "disabled", mode };
      queueInboxDecisionObservation(requestKey, skipped, inboxContext, inboxDeps);
      return skipped;
    }

    const maxInputChars = configOverrides.maxInputChars ?? AI_ROUTER_MAX_INPUT_CHARS;
    const maxActions = configOverrides.maxActions ?? AI_ROUTER_MAX_ACTIONS;
    const cheapModel = configOverrides.cheapModel ?? AI_ROUTER_CHEAP_MODEL;
    const mediumModel = configOverrides.mediumModel ?? AI_ROUTER_MEDIUM_MODEL;
    const confidenceThreshold =
      configOverrides.cheapConfidenceThreshold ?? AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD;

    const normalized = normalizeForRouting(rawText, { maxChars: maxInputChars, inputSource });

    let tier = "deterministic";
    let usage = null;
    let escalated = false;
    let rawContract = detectDeterministicIntent(normalized.normalized);

    if (!rawContract) {
      const activeProvider = provider || getDefaultProvider();

      const cheapResult = await analyzeIntent(normalized, {
        provider: activeProvider,
        model: cheapModel,
        maxActions,
      });

      tier = "cheap";
      usage = cheapResult.usage;

      if (!cheapResult.ok) {
        // "Provider failure -> deterministic fallback, no crash": we do
        // not guess: no safe action, ask for clarification, log why.
        rawContract = {
          language: "unknown",
          actions: [],
          needsClarification: true,
          clarificationQuestion: null,
          shouldEscalate: false,
          reasonCode: `tier1_failed:${cheapResult.reason || "unknown"}`,
        };
        tier = "fallback";
      } else {
        // Canonicalize aliases (title/text → content) before the escalation
        // check so a complete task that used payload.title is not treated
        // as "missing content" and needlessly sent to the medium model.
        const normalizedCheap = {
          ...cheapResult,
          contract: normalizeRoutingContract(cheapResult.contract),
        };
        rawContract = normalizedCheap.contract;

        if (shouldEscalateToMediumTier(normalizedCheap, normalized, { confidenceThreshold })) {
          escalated = true;

          const mediumResult = await planWithMediumTier(normalized, {
            provider: activeProvider,
            cheapContract: normalizedCheap.contract,
            model: mediumModel,
            maxActions,
          });

          if (mediumResult.ok) {
            tier = "medium";
            usage = mediumResult.usage;
            rawContract = normalizeRoutingContract(mediumResult.contract);
          } else {
            // Medium tier failed — keep the cheap tier's result rather
            // than escalating further or crashing. Tier 3 does not exist
            // in this milestone.
            rawContract = {
              ...normalizedCheap.contract,
              reasonCode: `tier2_failed:${mediumResult.reason || "unknown"}`,
            };
          }
        }
      }
    } else {
      rawContract = normalizeRoutingContract(rawContract);
    }

    const validated = validateRoutingContract(rawContract, {
      inputSource,
      maxActions,
      confidenceThreshold,
    });

    const execution = await executeActionsFn(
      validated.actions,
      {
        mode,
        chatId,
        userId: from?.id ?? null,
        actorKey:
          context.actor?.actorKey ||
          (from?.id != null ? `telegram:${from.id}` : null),
        username: from?.username ?? null,
        firstName: from?.first_name ?? null,
        requestKey,
        inputSource,
      },
      executorDeps
    );

    const skippedReasons = summarizeSkippedReasons(execution.results);

    const decision = {
      mode,
      tier,
      escalated,
      inputSource,
      language: validated.language,
      actions: validated.actions,
      rejectedActions: validated.rejectedActions,
      needsClarification: validated.needsClarification,
      clarificationQuestion: validated.clarificationQuestion,
      shouldEscalate: validated.shouldEscalate,
      reasonCode: validated.reasonCode,
      // Informational only — reflects whether the validator considers the
      // plan clean/actionable, independent of whether it was actually run.
      wouldExecute: validated.wouldExecute,
      execution: execution.results,
      executedCount: execution.executedCount,
      skippedCount: execution.skippedCount,
      skippedReasons,
      executed: execution.executedCount > 0,
      usage,
      inputPreview: sanitizedPreview(normalized.normalized),
      timings: { totalMs: Date.now() - startedAt },
    };

    logDecision(decision);

    // Inbox audit only — never mutates decision / never awaited here.
    queueInboxDecisionObservation(requestKey, decision, inboxContext, inboxDeps);

    return decision;
  } catch (error) {
    queueInboxFailure(requestKey, "routing_failed", inboxDeps);
    throw error;
  }
}

// The only two action types the AI router is ever allowed to own/execute
// (see actionExecutor.js's EXECUTABLE_ACTION_TYPES) — kept as its own
// small local constant so ownership derivation never silently grows to
// cover a type actionExecutor.js doesn't actually execute.
const OWNABLE_ACTION_TYPES = ["task_create", "memory_save", "idea_create"];

/**
 * Derives "AI ownership" from a decision returned by decideRouting():
 * the subset of task_create/memory_save actions that were ACTUALLY
 * executed (execution[].executed === true) — never merely planned,
 * validated, or "would execute". This is the single source of truth
 * handlers/messageHandler.js uses to decide whether to (a) send a
 * user-visible confirmation and (b) suppress the legacy generic
 * Memory-save fallback for this message. A `decideRouting()` failure or
 * a `{ skipped: true }` result (disabled/off) both safely yield no
 * ownership, so legacy behavior runs completely unaffected.
 *
 * @param {object|{skipped:true}|null|undefined} decision - decideRouting()'s return value.
 * @returns {{ executedActions: { action: object, executed: true, reason: string }[] }}
 */
export function getExecutedOwnedActions(decision) {
  if (!decision || decision.skipped || !Array.isArray(decision.execution)) {
    return { executedActions: [] };
  }

  const executedActions = decision.execution.filter(
    (result) => result?.executed === true && OWNABLE_ACTION_TYPES.includes(result.action?.type)
  );

  return { executedActions };
}

/**
 * Fire-and-forget shadow observer for handlers/messageHandler.js. Never
 * throws, never blocks the caller on a slow AI response in a way that
 * would delay the already-sent Telegram reply — callers should invoke
 * this without awaiting it (`.catch(...)` only).
 *
 * @param {string} rawText
 * @param {object} [context]
 * @returns {Promise<object|null>}
 */
export async function observeMessage(rawText, context = {}) {
  try {
    return await decideRouting(rawText, context);
  } catch (error) {
    console.error("[ai-router] shadow observation failed:", error?.message || error);
    return null;
  }
}
