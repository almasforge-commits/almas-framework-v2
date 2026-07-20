/**
 * Answer retriever — fixed-order retrieval across subsystems.
 * Order is mandatory and never changed.
 */

import {
  collectConversationEvidence,
  collectPersonalEvidence,
  collectReasoningEvidence,
  collectWorldEvidence,
  collectDomainEvidence,
} from "./evidenceCollector.js";

/**
 * Retrieve evidence in fixed order:
 * 1 Conversation → 2 Personal → 3 Reasoning → 4 World → 5 Domains
 *
 * @param {object} plan - from answerPlanner
 * @param {object} deps - injectable adapters
 * @param {object} [config]
 * @returns {Promise<{ evidence: object[], flags: object }>}
 */
export async function retrieveAnswerEvidence(plan, deps = {}, config = {}) {
  const evidence = [];
  const flags = {
    usedConversationContext: false,
    usedPersonalKnowledge: false,
    usedReasoning: false,
    usedWorldKnowledge: false,
    usedDomains: [],
  };

  const actorKey = plan.actorKey;
  const query = plan.query || "";
  const limitPersonal = config.maxPersonalHits ?? 20;
  const limitReasoning = config.maxReasoningHits ?? 12;
  const limitWorld = config.maxWorldHits ?? 8;
  const limitDomain = config.maxDomainHits ?? 12;

  // 1. Conversation Context
  if (plan.includeConversation && actorKey && plan.chatId != null) {
    try {
      const getPending =
        deps.getPending ??
        deps.clarificationEngine?.getPending?.bind(deps.clarificationEngine) ??
        deps.conversationContextStore?.get?.bind(
          deps.conversationContextStore
        );
      if (typeof getPending === "function") {
        const pending = await Promise.resolve(
          getPending(actorKey, plan.chatId)
        );
        const items = collectConversationEvidence(pending);
        if (items.length) {
          evidence.push(...items);
          flags.usedConversationContext = true;
        }
      }
    } catch {
      // never break orchestration
    }
  }

  // 2. Personal Knowledge
  if (plan.includePersonal && actorKey) {
    try {
      const retrieveFn =
        deps.retrievePersonal ??
        deps.personalKnowledgeEngine?.retrieve?.bind(
          deps.personalKnowledgeEngine
        );
      if (typeof retrieveFn === "function") {
        const result = await retrieveFn({
          actorKey,
          query,
          limit: limitPersonal,
          scopes: ["personal"],
        });
        const hits = Array.isArray(result?.results)
          ? result.results
          : Array.isArray(result)
            ? result
            : [];
        const items = collectPersonalEvidence(hits).slice(0, limitPersonal);
        if (items.length) {
          evidence.push(...items);
          flags.usedPersonalKnowledge = true;
        }
      }
    } catch {
      // swallow
    }
  }

  // 3. Reasoning Insights (+ recommendations)
  if (plan.includeReasoning && actorKey) {
    try {
      const engine = deps.reasoningEngine;
      let insights = [];
      let recommendations = [];
      if (engine) {
        if (query && typeof engine.searchInsights === "function") {
          insights = await Promise.resolve(
            engine.searchInsights(actorKey, query, { limit: limitReasoning })
          );
        } else if (typeof engine.listInsights === "function") {
          insights = await Promise.resolve(
            engine.listInsights(actorKey, { limit: limitReasoning })
          );
        }
        if (typeof engine.listRecommendations === "function") {
          recommendations = await Promise.resolve(
            engine.listRecommendations(actorKey, {
              limit: Math.min(6, limitReasoning),
            })
          );
        }
      } else if (typeof deps.listInsights === "function") {
        insights = await Promise.resolve(
          deps.listInsights(actorKey, { limit: limitReasoning })
        );
      }
      const items = collectReasoningEvidence(insights, recommendations).slice(
        0,
        limitReasoning
      );
      if (items.length) {
        evidence.push(...items);
        flags.usedReasoning = true;
      }
    } catch {
      // swallow
    }
  }

  // 4. World Knowledge Gateway (preferred) or legacy adapter
  if (plan.includeWorld && query) {
    try {
      let hits = [];
      const gateway = deps.worldKnowledgeGateway;
      if (gateway && typeof gateway.search === "function") {
        const gwResult = await gateway.search(query, {
          maxResults: limitWorld,
          ignoreEnabled: deps.worldGatewayIgnoreEnabled === true,
          forceEnabled: deps.worldGatewayForceEnabled === true,
          skipCache: deps.skipWorldCache === true,
        });
        hits = Array.isArray(gwResult?.results) ? gwResult.results : [];
        if (Array.isArray(gwResult?.errors) && gwResult.errors.length) {
          flags.worldGatewayErrors = gwResult.errors.slice(0, 8);
        }
      } else {
        const searchWorld =
          deps.searchWorld ??
          deps.worldKnowledgeAdapter?.search?.bind(deps.worldKnowledgeAdapter);
        if (typeof searchWorld === "function") {
          hits = await searchWorld(query, {
            limit: limitWorld,
            actorKey,
          });
        }
      }
      const items = collectWorldEvidence(hits).slice(0, limitWorld);
      if (items.length) {
        evidence.push(...items);
        flags.usedWorldKnowledge = true;
        flags.worldSources = items.map((e) => ({
          provider: e.provenance?.provider ?? null,
          url: e.provenance?.url ?? null,
          sourceType: e.provenance?.sourceType ?? null,
          confidence: e.confidence,
          language: e.provenance?.language ?? null,
          publishedAt: e.provenance?.publishedAt ?? null,
          retrievedAt: e.provenance?.retrievedAt ?? null,
          summary: e.summary,
        }));
      }
    } catch {
      // Gateway/adapter failure never breaks Answer Engine.
      flags.worldGatewayErrors = flags.worldGatewayErrors || [
        { code: "gateway_error", message: "world_retrieval_failed" },
      ];
    }
  }

  // 5. Domain readers (read-only injectables)
  if (plan.includeDomains) {
    const wanted = new Set(
      Array.isArray(plan.domains) && plan.domains.length
        ? plan.domains
        : ["finance", "tasks", "knowledge", "memory"]
    );

    if (wanted.has("finance") && typeof deps.getFinanceSnapshot === "function") {
      try {
        const snap = await deps.getFinanceSnapshot({ actorKey, query });
        const items = collectDomainEvidence("finance", snap).slice(
          0,
          limitDomain
        );
        if (items.length) {
          evidence.push(...items);
          flags.usedDomains.push("finance");
        }
      } catch {
        // swallow
      }
    }

    if (wanted.has("tasks") && typeof deps.getTasksSnapshot === "function") {
      try {
        const snap = await deps.getTasksSnapshot({ actorKey, query });
        const items = collectDomainEvidence("tasks", snap).slice(0, limitDomain);
        if (items.length) {
          evidence.push(...items);
          flags.usedDomains.push("tasks");
        }
      } catch {
        // swallow
      }
    }

    if (
      wanted.has("knowledge") &&
      typeof deps.searchKnowledgeFn === "function"
    ) {
      try {
        const snap = await deps.searchKnowledgeFn(query, { actorKey });
        const items = collectDomainEvidence("knowledge", snap).slice(
          0,
          limitDomain
        );
        if (items.length) {
          evidence.push(...items);
          flags.usedDomains.push("knowledge");
        }
      } catch {
        // swallow
      }
    }

    if (wanted.has("memory") && typeof deps.searchMemoryFn === "function") {
      try {
        const snap = await deps.searchMemoryFn(query, { actorKey });
        const items = collectDomainEvidence("memory", snap).slice(
          0,
          limitDomain
        );
        if (items.length) {
          evidence.push(...items);
          flags.usedDomains.push("memory");
        }
      } catch {
        // swallow
      }
    }
  }

  flags.usedDomains = [...new Set(flags.usedDomains)];
  return { evidence, flags };
}
