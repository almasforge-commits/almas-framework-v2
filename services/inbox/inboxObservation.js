import { isInboxEnabled } from "../../config/inbox.js";
import {
  createReceivedInboxItem,
  recordInboxAnalysis,
  recordInboxExecution,
  recordInboxFailure,
  recordInboxUniversalExtraction,
  recordInboxPersonalKnowledgeSummary,
  recordInboxReasoningSummary,
} from "./inboxService.js";
import { extractUniversalInformation } from "./universalExtractor.js";
import { AI_ROUTER_MAX_ACTIONS } from "../../config/aiRouter.js";
import { runPersonalKnowledgeShadowIngest } from "../personalKnowledge/personalKnowledgeObservation.js";
import { runReasoningShadowObservation } from "../reasoning/reasoningObservation.js";

// Runtime-facing Inbox observer. Best-effort, never throws to callers.
// Per-requestKey promise chain preserves received → analysis → execution
// order without blocking Telegram replies (callers must not await).

/** @type {Map<string, Promise<unknown>>} */
const observationChains = new Map();

/** @type {Set<string>} */
const loggedPersistFailures = new Set();

/**
 * @param {"text"|"voice"|string|null|undefined} inputSource
 * @returns {"telegram_text"|"telegram_voice"}
 */
export function mapInputSourceToInboxSourceType(inputSource) {
  return inputSource === "voice" ? "telegram_voice" : "telegram_text";
}

function inboxActive(deps = {}) {
  return deps.forceEnabled === true || isInboxEnabled();
}

function logPersistFailureOnce(requestKey, errorCode) {
  const key = String(requestKey ?? "");
  if (!key || loggedPersistFailures.has(key)) return;
  loggedPersistFailures.add(key);
  const code =
    typeof errorCode === "string" && errorCode.trim() ? errorCode.trim() : "inbox_persist_failed";
  console.error(`[inbox] persist failed requestKey=${key} code=${code}`);
}

/**
 * Enqueues a step on the per-requestKey chain. Prior step failures do not
 * block later steps from running (each step handles its own errors).
 *
 * @param {string} requestKey
 * @param {() => Promise<unknown>} step
 * @returns {Promise<unknown>}
 */
function enqueueObservation(requestKey, step) {
  const key = String(requestKey);
  const previous = observationChains.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(step);
  observationChains.set(key, next);
  next.finally(() => {
    if (observationChains.get(key) === next) {
      observationChains.delete(key);
    }
  });
  return next;
}

/**
 * Awaits the current observation tail for tests. No-op when empty.
 * @param {string} requestKey
 * @returns {Promise<void>}
 */
export async function flushInboxObservation(requestKey) {
  if (!requestKey) return;
  const tail = observationChains.get(String(requestKey));
  if (tail) {
    await tail.catch(() => {});
  }
}

/** @internal test helper — clears chain + failure-log state */
export function resetInboxObservationStateForTests() {
  observationChains.clear();
  loggedPersistFailures.clear();
}

/**
 * Starts received observation for one message. Returns immediately.
 * Persistence runs on the per-requestKey chain (do not await in handlers).
 *
 * @param {object} input
 * @param {object} [deps]
 */
export function startInboxReceivedObservation(input = {}, deps = {}) {
  if (!inboxActive(deps)) return;
  if (!input.requestKey) return;

  const requestKey = String(input.requestKey);

  enqueueObservation(requestKey, async () => {
    try {
      const createFn = deps.createReceivedInboxItemFn ?? createReceivedInboxItem;
      const result = await createFn(
        {
          requestKey,
          sourceType: input.sourceType ?? "telegram_text",
          actor: input.actor,
          originalText: input.originalText ?? input.text ?? "",
          normalizedText: input.normalizedText ?? input.originalText ?? input.text ?? "",
          language: input.language ?? "unknown",
          metadata: input.metadata ?? {},
        },
        deps
      );

      if (result && result.success === false && result.skipped !== true) {
        logPersistFailureOnce(requestKey, result.errorCode || result.reason);
      }
    } catch (error) {
      logPersistFailureOnce(requestKey, error?.code || "inbox_create_failed");
    }
  });
}

/**
 * Queues analysis recording after received for the same requestKey.
 *
 * @param {string} requestKey
 * @param {object} analysis
 * @param {object} [deps]
 */
export function queueInboxAnalysis(requestKey, analysis = {}, deps = {}) {
  if (!inboxActive(deps)) return;
  if (!requestKey) return;

  const key = String(requestKey);

  enqueueObservation(key, async () => {
    try {
      const recordFn = deps.recordInboxAnalysisFn ?? recordInboxAnalysis;
      const result = await recordFn(key, analysis, deps);
      if (result && result.success === false && result.skipped !== true) {
        logPersistFailureOnce(key, result.errorCode || result.reason);
      }
    } catch (error) {
      logPersistFailureOnce(key, error?.code || "inbox_analysis_failed");
    }
  });
}

/**
 * Queues execution recording after analysis for the same requestKey.
 *
 * @param {string} requestKey
 * @param {object} execution
 * @param {object} [deps]
 */
export function queueInboxExecution(requestKey, execution = {}, deps = {}) {
  if (!inboxActive(deps)) return;
  if (!requestKey) return;

  const key = String(requestKey);

  enqueueObservation(key, async () => {
    try {
      const recordFn = deps.recordInboxExecutionFn ?? recordInboxExecution;
      const result = await recordFn(key, execution, deps);
      if (result && result.success === false && result.skipped !== true) {
        logPersistFailureOnce(key, result.errorCode || result.reason);
      }
    } catch (error) {
      logPersistFailureOnce(key, error?.code || "inbox_execution_failed");
    }
  });
}

/**
 * Queues failure recording on the same ordered chain.
 *
 * @param {string} requestKey
 * @param {string} [errorCode]
 * @param {object} [deps]
 */
export function queueInboxFailure(requestKey, errorCode = "routing_failed", deps = {}) {
  if (!inboxActive(deps)) return;
  if (!requestKey) return;

  const key = String(requestKey);

  enqueueObservation(key, async () => {
    try {
      const recordFn = deps.recordInboxFailureFn ?? recordInboxFailure;
      const result = await recordFn(key, errorCode, deps);
      if (result && result.success === false && result.skipped !== true) {
        logPersistFailureOnce(key, result.errorCode || result.reason);
      }
    } catch (error) {
      logPersistFailureOnce(key, error?.code || "inbox_failure_record_failed");
    }
  });
}

/**
 * After a final decideRouting() decision: queue analysis then execution.
 * Never mutates or returns a different decision. Never throws.
 *
 * @param {string|null|undefined} requestKey
 * @param {object} decision
 * @param {object} [context]
 * @param {object} [deps]
 */
export function queueInboxDecisionObservation(requestKey, decision, context = {}, deps = {}) {
  if (!inboxActive(deps)) return;
  if (!requestKey || !decision || typeof decision !== "object") return;

  const key = String(requestKey);

  queueInboxAnalysis(
    key,
    {
      routingDecision: decision,
      normalizedText: context.normalizedText ?? "",
      sourceType: context.sourceType ?? null,
      language: decision.language ?? "unknown",
      needsClarification: Boolean(decision.needsClarification),
    },
    deps
  );

  // Shadow universal extraction — observation only; never blocks Telegram;
  // never changes the routing decision object returned to callers.
  enqueueObservation(key, async () => {
    try {
      const text =
        context.originalText ||
        context.normalizedText ||
        "";
      const extractFn =
        deps.extractUniversalInformationFn ?? extractUniversalInformation;
      const allowDefault =
        Boolean(deps.extractionProvider)
          ? false
          : deps.allowDefaultExtractionProvider === true ||
            (deps.forceEnabled !== true && isInboxEnabled());

      const extraction = await extractFn(text, {
        provider: deps.extractionProvider ?? null,
        allowDefaultProvider: allowDefault,
        maxItems: deps.maxExtractionItems ?? AI_ROUTER_MAX_ACTIONS,
        inputSource: context.inputSource || "text",
        language: decision.language || "unknown",
      });

      const recordFn =
        deps.recordInboxUniversalExtractionFn ?? recordInboxUniversalExtraction;
      const result = await recordFn(key, extraction, deps);
      if (result && result.success === false && result.skipped !== true) {
        logPersistFailureOnce(key, result.errorCode || result.reason);
      }

      // Personal Knowledge shadow ingest — uses extraction already produced
      // above. Never re-extracts, never changes Telegram / domain execution.
      try {
        const pkIngestFn =
          deps.runPersonalKnowledgeShadowIngestFn ??
          runPersonalKnowledgeShadowIngest;
        const pkResult = await pkIngestFn(
          {
            requestKey: key,
            extraction,
            actor: context.actor ?? null,
            sourceType: context.sourceType ?? null,
            originalText: context.originalText ?? null,
          },
          deps.personalKnowledgeDeps ?? deps
        );

        if (pkResult && pkResult.skipped !== true && pkResult.summary) {
          const recordPkFn =
            deps.recordInboxPersonalKnowledgeSummaryFn ??
            recordInboxPersonalKnowledgeSummary;
          const pkRecord = await recordPkFn(key, pkResult.summary, deps);
          if (
            pkRecord &&
            pkRecord.success === false &&
            pkRecord.skipped !== true
          ) {
            logPersistFailureOnce(
              key,
              pkRecord.errorCode || pkRecord.reason || "inbox_pk_summary_failed"
            );
          }
        }

        // Reasoning shadow observation — after PK ingest; uses accepted
        // personal facts only. Audit summary only; never changes Telegram.
        try {
          const reasoningFn =
            deps.runReasoningShadowObservationFn ??
            runReasoningShadowObservation;
          const reasoningDeps = {
            ...(deps.reasoningDeps ?? deps),
            personalKnowledgeDeps: deps.personalKnowledgeDeps,
            personalKnowledgeEngine:
              deps.personalKnowledgeDeps?.personalKnowledgeEngine ??
              deps.personalKnowledgeEngine,
            forcePersonalKnowledgeEnabled:
              deps.personalKnowledgeDeps?.forcePersonalKnowledgeEnabled ??
              deps.forcePersonalKnowledgeEnabled,
          };
          const reasoningResult = await reasoningFn(
            {
              requestKey: key,
              actor: context.actor ?? null,
              personalKnowledgeSummary: pkResult?.summary ?? null,
              acceptedCount:
                pkResult?.summary?.personalKnowledge?.accepted ?? 0,
            },
            reasoningDeps
          );

          if (
            reasoningResult &&
            reasoningResult.summary &&
            reasoningResult.skipped !== true
          ) {
            const recordReasoningFn =
              deps.recordInboxReasoningSummaryFn ??
              recordInboxReasoningSummary;
            const reasoningRecord = await recordReasoningFn(
              key,
              reasoningResult.summary,
              deps
            );
            if (
              reasoningRecord &&
              reasoningRecord.success === false &&
              reasoningRecord.skipped !== true
            ) {
              logPersistFailureOnce(
                key,
                reasoningRecord.errorCode ||
                  reasoningRecord.reason ||
                  "inbox_reasoning_summary_failed"
              );
            }
          }
        } catch {
          logPersistFailureOnce(key, "inbox_reasoning_observation_failed");
        }
      } catch {
        logPersistFailureOnce(key, "inbox_personal_knowledge_ingest_failed");
      }
    } catch (error) {
      logPersistFailureOnce(key, error?.code || "inbox_extraction_failed");
    }
  });

  const execution = decision.skipped
    ? {
        results: [],
        executedCount: 0,
        skippedCount: 0,
        needsClarification: false,
      }
    : {
        results: decision.execution,
        executedCount: decision.executedCount ?? 0,
        skippedCount: decision.skippedCount ?? 0,
        needsClarification: Boolean(decision.needsClarification),
      };

  queueInboxExecution(key, execution, deps);
}
