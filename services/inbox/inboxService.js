import { isInboxEnabled, getInboxConfig } from "../../config/inbox.js";
import {
  createInboxItem,
  validateInboxStatus,
  summarizeRoutingDecision,
  summarizeExecutionResult,
} from "./inboxContracts.js";
import { classifyInformationKinds } from "./informationKindClassifier.js";
import {
  sanitizeRoutingDecision,
  sanitizeExecutionSummary,
  sanitizeInboxError,
  sanitizeInboxMetadata,
} from "./inboxSanitizer.js";
import { sanitizeUniversalExtraction } from "./universalExtractionSanitizer.js";
import {
  insertInboxItem,
  updateInboxItemByRequestKey,
  findInboxItemByRequestKey,
  listInboxItems,
} from "../../providers/storage/supabaseInboxDriver.js";

// Inbox service — audit/structuring only. NEVER imports Finance/Memory/
// Tasks/Knowledge/actionExecutor/Telegram/OpenAI. Disabled by default.

function disabledResult() {
  return {
    success: true,
    skipped: true,
    reason: "inbox_disabled",
    item: null,
  };
}

function failureResult(errorCode, error = null) {
  const sanitized = sanitizeInboxError(error ?? { errorCode });
  return {
    success: false,
    skipped: false,
    reason: sanitized.errorCode || errorCode,
    item: null,
    errorCode: sanitized.errorCode || errorCode,
    message: sanitized.message,
  };
}

function capText(text, maxChars) {
  const value = String(text ?? "");
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars);
}

function deriveExecutionStatus(summary, analysisNeedsClarification = false) {
  if (analysisNeedsClarification) return "clarification_required";
  if (!summary) return "skipped";

  const executed = summary.executedCount ?? 0;
  const skipped = summary.skippedCount ?? 0;
  const results = Array.isArray(summary.results) ? summary.results : [];
  const hasFailure = results.some(
    (r) => r?.executed === false && /domain_error|failed/i.test(String(r?.reason ?? ""))
  );

  if (hasFailure && executed === 0) return "failed";
  if (executed > 0 && skipped > 0) return "partially_executed";
  if (executed > 0) return "executed";
  if (skipped > 0) return "skipped";
  return "skipped";
}

/**
 * Creates (or upserts) a received Inbox item. Dependency-injectable.
 */
export async function createReceivedInboxItem(input = {}, deps = {}) {
  if (!(deps.forceEnabled === true) && !isInboxEnabled()) {
    return disabledResult();
  }

  try {
    if (!input.requestKey || !String(input.requestKey).trim()) {
      return failureResult("invalid_request_key");
    }

    const actor = input.actor;
    if (!actor || typeof actor !== "object" || !actor.actorKey) {
      return failureResult("invalid_actor");
    }

    const config = getInboxConfig();
    const maxChars = config.maxTextChars;

    const item = createInboxItem({
      ...input,
      originalText: capText(input.originalText ?? input.text ?? "", maxChars),
      normalizedText: capText(
        input.normalizedText ?? input.originalText ?? input.text ?? "",
        maxChars
      ),
      status: "received",
      metadata: sanitizeInboxMetadata(input.metadata ?? {}, {
        maxDepth: config.maxMetadataDepth,
        maxKeys: config.maxMetadataKeys,
      }),
    });

    const insertFn = deps.insertInboxItemFn ?? insertInboxItem;
    const saved = await insertFn(item, deps);

    return { success: true, skipped: false, reason: null, item: saved };
  } catch (error) {
    return failureResult("inbox_create_failed", error);
  }
}

/**
 * Records analysis (language, kinds, sanitized routing decision).
 */
export async function recordInboxAnalysis(requestKey, analysis = {}, deps = {}) {
  if (!(deps.forceEnabled === true) && !isInboxEnabled()) {
    return disabledResult();
  }

  try {
    if (!requestKey) return failureResult("invalid_request_key");

    const config = getInboxConfig();
    const decision = analysis.routingDecision ?? analysis.decision ?? null;
    const summary = summarizeRoutingDecision(decision);
    const sanitizedDecision = sanitizeRoutingDecision(summary ?? decision, {
      maxDepth: config.maxMetadataDepth,
      maxKeys: config.maxMetadataKeys,
    });

    const classified = classifyInformationKinds({
      normalizedText: analysis.normalizedText ?? analysis.text ?? "",
      routingDecision: decision,
      sourceType: analysis.sourceType ?? null,
    });

    const needsClarification = Boolean(
      decision?.needsClarification || analysis.needsClarification
    );
    const status = needsClarification ? "clarification_required" : "analyzed";

    const updateFn = deps.updateInboxItemByRequestKeyFn ?? updateInboxItemByRequestKey;
    const item = await updateFn(
      requestKey,
      {
        language: analysis.language ?? decision?.language ?? "unknown",
        informationKinds: classified.informationKinds,
        routingDecision: sanitizedDecision,
        status: validateInboxStatus(status) ?? "analyzed",
        metadata: {
          classificationReasons: classified.reasonCodes,
        },
      },
      deps
    );

    return { success: true, skipped: false, reason: null, item };
  } catch (error) {
    return failureResult("inbox_analysis_failed", error);
  }
}

/**
 * Persists sanitized universal extraction into metadata + routing_decision.
 * Shadow audit only — never executes domain actions.
 */
export async function recordInboxUniversalExtraction(
  requestKey,
  extraction,
  deps = {}
) {
  if (!(deps.forceEnabled === true) && !isInboxEnabled()) {
    return disabledResult();
  }

  try {
    if (!requestKey) return failureResult("invalid_request_key");

    const sanitized = sanitizeUniversalExtraction(extraction);
    if (!sanitized) {
      return failureResult("invalid_extraction");
    }

    const findFn = deps.findInboxItemByRequestKeyFn ?? findInboxItemByRequestKey;
    const existing = await findFn(requestKey, deps);
    const prevMeta =
      existing?.metadata && typeof existing.metadata === "object"
        ? existing.metadata
        : {};
    const prevDecision =
      existing?.routingDecision && typeof existing.routingDecision === "object"
        ? existing.routingDecision
        : {};

    const updateFn = deps.updateInboxItemByRequestKeyFn ?? updateInboxItemByRequestKey;
    const item = await updateFn(
      requestKey,
      {
        metadata: {
          ...prevMeta,
          universalExtraction: sanitized,
        },
        routingDecision: {
          ...prevDecision,
          universalExtraction: sanitized,
        },
      },
      deps
    );

    return { success: true, skipped: false, reason: null, item };
  } catch (error) {
    return failureResult("inbox_extraction_record_failed", error);
  }
}

/**
 * Records execution summary and derived lifecycle status.
 */
export async function recordInboxExecution(requestKey, execution = {}, deps = {}) {
  if (!(deps.forceEnabled === true) && !isInboxEnabled()) {
    return disabledResult();
  }

  try {
    if (!requestKey) return failureResult("invalid_request_key");

    const config = getInboxConfig();
    const summary = sanitizeExecutionSummary(
      summarizeExecutionResult(execution) ?? execution,
      {
        maxDepth: config.maxMetadataDepth,
        maxKeys: config.maxMetadataKeys,
      }
    );

    const status = deriveExecutionStatus(
      summary,
      Boolean(execution.needsClarification)
    );

    const updateFn = deps.updateInboxItemByRequestKeyFn ?? updateInboxItemByRequestKey;
    const item = await updateFn(
      requestKey,
      {
        executionSummary: summary,
        status: validateInboxStatus(status) ?? "skipped",
      },
      deps
    );

    return { success: true, skipped: false, reason: null, item };
  } catch (error) {
    return failureResult("inbox_execution_failed", error);
  }
}

/**
 * Records a failed lifecycle status with a stable errorCode.
 */
export async function recordInboxFailure(requestKey, errorCode, deps = {}) {
  if (!(deps.forceEnabled === true) && !isInboxEnabled()) {
    return disabledResult();
  }

  try {
    if (!requestKey) return failureResult("invalid_request_key");

    const sanitized = sanitizeInboxError(
      typeof errorCode === "string" ? { errorCode } : errorCode
    );

    const updateFn = deps.updateInboxItemByRequestKeyFn ?? updateInboxItemByRequestKey;
    const item = await updateFn(
      requestKey,
      {
        status: "failed",
        errorCode: sanitized.errorCode,
      },
      deps
    );

    return { success: true, skipped: false, reason: null, item };
  } catch (error) {
    return failureResult("inbox_failure_record_failed", error);
  }
}

export async function getInboxItems(filters = {}, deps = {}) {
  if (!(deps.forceEnabled === true) && !isInboxEnabled()) {
    return disabledResult();
  }

  try {
    const listFn = deps.listInboxItemsFn ?? listInboxItems;
    const items = await listFn(filters, deps);
    return { success: true, skipped: false, reason: null, items };
  } catch (error) {
    return failureResult("inbox_list_failed", error);
  }
}

/**
 * Best-effort lifecycle observer for a future Telegram hook.
 * Never throws. When disabled, returns skipped without driver calls.
 *
 * @param {object} input
 * @param {"received"|"analysis"|"execution"|"failure"} operation
 * @param {object} [deps]
 */
export async function observeInboxLifecycle(input = {}, operation = "received", deps = {}) {
  try {
    if (operation === "received") {
      return await createReceivedInboxItem(input, deps);
    }
    if (operation === "analysis") {
      return await recordInboxAnalysis(input.requestKey, input, deps);
    }
    if (operation === "execution") {
      return await recordInboxExecution(input.requestKey, input.execution ?? input, deps);
    }
    if (operation === "failure") {
      return await recordInboxFailure(input.requestKey, input.errorCode ?? input, deps);
    }
    return failureResult("unknown_operation");
  } catch (error) {
    return failureResult("inbox_observe_failed", error);
  }
}

// Kept for backward compatibility with the unused legacy stub export
// name space — not used by live routing. Does not call OpenAI.
export async function processInbox() {
  return disabledResult();
}

export { findInboxItemByRequestKey };
