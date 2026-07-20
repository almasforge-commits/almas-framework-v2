import { askAI } from "./openaiProvider.js";
import {
  LANGUAGES,
  ACTION_TYPES,
  PAYLOAD_FIELDS,
} from "../../services/inbox/contracts.js";

// contracts.js is pure vocabulary (enums/factories, zero side effects,
// zero Telegram/Supabase/domain-service imports) — importing it here
// does not violate the "AI providers never import domain services" rule.
// It exists so the OpenAI JSON schema below and the rest of the pipeline
// can never drift out of sync on the allowed action types.

const NULLABLE_STRING = { type: ["string", "null"] };
const NULLABLE_NUMBER = { type: ["number", "null"] };

const PAYLOAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    amount: NULLABLE_NUMBER,
    currency: NULLABLE_STRING,
    description: NULLABLE_STRING,
    content: NULLABLE_STRING,
    query: NULLABLE_STRING,
    date: NULLABLE_STRING,
    command: NULLABLE_STRING,
  },
  required: PAYLOAD_FIELDS,
};

const ROUTING_CONTRACT_SCHEMA = {
  name: "almas_routing_contract",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      language: { type: "string", enum: LANGUAGES },
      actions: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ACTION_TYPES },
            confidence: { type: "number" },
            payload: PAYLOAD_SCHEMA,
            requiresConfirmation: { type: "boolean" },
          },
          required: ["type", "confidence", "payload", "requiresConfirmation"],
        },
      },
      needsClarification: { type: "boolean" },
      clarificationQuestion: NULLABLE_STRING,
      shouldEscalate: { type: "boolean" },
      reasonCode: { type: "string" },
    },
    required: [
      "language",
      "actions",
      "needsClarification",
      "clarificationQuestion",
      "shouldEscalate",
      "reasonCode",
    ],
  },
};

/**
 * OpenAI-backed implementation of the provider-neutral PlannerProvider
 * contract (see plannerProvider.js). Reuses the existing, already-lazy
 * providers/ai/openaiProvider.js (askAI) rather than constructing its
 * own OpenAI client, so it inherits the same lazy-client, no-throw-at-
 * import-time behavior and stays consistent with the rest of the
 * codebase's AI-calling convention (see services/inbox/inboxClassifier.js
 * for the same askAI + json_schema pattern).
 *
 * @param {object} [options]
 * @param {Function} [options.askAIFn] - Injected for tests; must never
 *   be left as the real askAI when testing (that would attempt a real
 *   OpenAI call).
 * @returns {import("./plannerProvider.js").PlannerProvider}
 */
export function createOpenAiPlannerProvider(options = {}) {
  const { askAIFn = askAI } = options;

  return {
    name: "openai",

    async run({ systemPrompt, userPrompt }, { model }) {
      const startedAt = Date.now();

      let raw;

      try {
        raw = await askAIFn(systemPrompt, userPrompt, ROUTING_CONTRACT_SCHEMA, {
          model,
        });
      } catch (error) {
        return {
          ok: false,
          result: null,
          reason: "provider_error",
          usage: { model, latencyMs: Date.now() - startedAt },
        };
      }

      const usage = {
        model,
        latencyMs: Date.now() - startedAt,
        promptChars: (systemPrompt?.length ?? 0) + (userPrompt?.length ?? 0),
      };

      if (!raw || typeof raw !== "object") {
        return { ok: false, result: null, reason: "empty_response", usage };
      }

      return { ok: true, result: raw, usage };
    },
  };
}
