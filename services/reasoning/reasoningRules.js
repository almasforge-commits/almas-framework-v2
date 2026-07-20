/**
 * Deterministic reasoning rules (no LLM).
 * Each rule inspects personal facts and may emit a candidate insight draft
 * with supporting fact ids — never invents fact content.
 */

import { normalizeInsightText } from "./reasoningContracts.js";

/**
 * @typedef {object} PersonalFactLike
 * @property {string} id
 * @property {string} actorKey
 * @property {string} domain
 * @property {string} content
 * @property {string} [normalizedContent]
 * @property {number} [confidence]
 * @property {number} [createdAt]
 * @property {string} [scope]
 */

/**
 * @typedef {object} RuleCandidate
 * @property {string} type
 * @property {string} title
 * @property {string} description
 * @property {string[]} factIds
 * @property {string[]} relatedDomains
 * @property {string[]} [relatedEntities]
 * @property {string[]} [contradictionFactIds]
 * @property {string} ruleId
 */

const NIGHT_WORK = Object.freeze([
  /ночь/i,
  /ночью/i,
  /at\s*night/i,
  /working\s*at\s*night/i,
  /after\s*10\s*pm/i,
  /after\s*22/i,
  /late\s*night/i,
  /night\s*work/i,
  /productive.*night/i,
  /работа.*ноч/i,
]);

const DAY_FOCUS_LOSS = Object.freeze([
  /теряю\s*фокус.*дн/i,
  /lose\s*focus.*day/i,
  /днём.*не\s*могу/i,
  /during\s*the\s*day/i,
]);

const PREFERENCE = Object.freeze([
  /нравится/i,
  /предпочитаю/i,
  /\bi\s+(like|prefer|love)\b/i,
  /не\s*люблю/i,
]);

const FINANCE = Object.freeze([
  /потратил/i,
  /расход/i,
  /expense/i,
  /купил/i,
  /доход/i,
  /budget/i,
  /бюджет/i,
]);

const SLEEP = Object.freeze([
  /\bсон\b/i,
  /\bsleep\b/i,
  /спал/i,
  /recovery/i,
  /восстановлен/i,
]);

const HABIT = Object.freeze([
  /привычка/i,
  /habit/i,
  /каждый\s*день/i,
  /every\s*day/i,
  /ежедневно/i,
  /обычно\s*я/i,
]);

const HEALTH = Object.freeze([
  /whoop/i,
  /вес/i,
  /weight/i,
  /exercise/i,
  /тренир/i,
  /recovery/i,
  /здоров/i,
]);

const IDEA = Object.freeze([/идея/i, /\bidea\b/i, /concept/i]);

const PROJECT = Object.freeze([/проект/i, /\bproject\b/i, /работаю\s*над/i]);

const GOAL = Object.freeze([/цель/i, /\bgoal\b/i, /хочу\s*достичь/i]);

const DECISION = Object.freeze([/решил/i, /решила/i, /decision/i, /решение/i]);

const COMPANY = Object.freeze([
  /\b(openai|anthropic|google|apple|microsoft|meta|whoop|almas)\b/i,
]);

/**
 * @type {ReadonlyArray<{ id: string, type: string, match: (f: PersonalFactLike) => boolean, contradict?: (f: PersonalFactLike) => boolean, title: string, description: (facts: PersonalFactLike[]) => string, domains: string[] }>}
 */
export const REASONING_RULES = Object.freeze([
  {
    id: "productivity_night_work",
    type: "ProductivityPattern",
    match: (f) => matchesAny(contentOf(f), NIGHT_WORK) || matchesAny(contentOf(f), DAY_FOCUS_LOSS),
    contradict: (f) =>
      /утром\s*продуктивн/i.test(contentOf(f)) ||
      /morning\s*person/i.test(contentOf(f)) ||
      /best\s*in\s*the\s*morning/i.test(contentOf(f)),
    title: "Optimal work period appears to be night",
    description: () =>
      "Multiple personal facts indicate higher productivity or preference for night work, and/or reduced daytime focus.",
    domains: ["Preferences", "Habits", "Knowledge"],
  },
  {
    id: "preference_repeated",
    type: "PreferencePattern",
    match: (f) =>
      f.domain === "Preferences" || matchesAny(contentOf(f), PREFERENCE),
    title: "Stable preference pattern detected",
    description: (facts) =>
      `Repeated preference signals across ${facts.length} personal facts.`,
    domains: ["Preferences"],
  },
  {
    id: "finance_repeated_expenses",
    type: "FinancialPattern",
    match: (f) => f.domain === "Finance" || matchesAny(contentOf(f), FINANCE),
    title: "Recurring financial activity pattern",
    description: (facts) =>
      `Repeated expense/finance mentions across ${facts.length} personal facts.`,
    domains: ["Finance"],
  },
  {
    id: "sleep_pattern",
    type: "SleepPattern",
    match: (f) => matchesAny(contentOf(f), SLEEP),
    title: "Sleep / recovery pattern detected",
    description: (facts) =>
      `Repeated sleep or recovery references across ${facts.length} personal facts.`,
    domains: ["Health", "Habits"],
  },
  {
    id: "habit_pattern",
    type: "HabitPattern",
    match: (f) => f.domain === "Habits" || matchesAny(contentOf(f), HABIT),
    title: "Habit pattern detected",
    description: (facts) =>
      `Repeated habit signals across ${facts.length} personal facts.`,
    domains: ["Habits"],
  },
  {
    id: "health_exercise_recovery",
    type: "HealthPattern",
    match: (f) => f.domain === "Health" || matchesAny(contentOf(f), HEALTH),
    title: "Health / recovery pattern detected",
    description: (facts) =>
      `Repeated health, exercise, or recovery signals across ${facts.length} personal facts.`,
    domains: ["Health"],
  },
  {
    id: "idea_cluster",
    type: "IdeaPattern",
    match: (f) => f.domain === "Ideas" || matchesAny(contentOf(f), IDEA),
    title: "Idea concentration pattern",
    description: (facts) => deriveIdeaThemeDescription(facts),
    domains: ["Ideas"],
  },
  {
    id: "project_repeated",
    type: "ProjectPattern",
    match: (f) => f.domain === "Projects" || matchesAny(contentOf(f), PROJECT),
    title: "Recurring project focus",
    description: (facts) =>
      `Repeated project mentions across ${facts.length} personal facts.`,
    domains: ["Projects"],
  },
  {
    id: "goal_repeated",
    type: "GoalPattern",
    match: (f) => f.domain === "Goals" || matchesAny(contentOf(f), GOAL),
    title: "Recurring goal focus",
    description: (facts) =>
      `Repeated goal signals across ${facts.length} personal facts.`,
    domains: ["Goals"],
  },
  {
    id: "decision_repeated",
    type: "DecisionPattern",
    match: (f) => f.domain === "Decisions" || matchesAny(contentOf(f), DECISION),
    title: "Decision pattern detected",
    description: (facts) =>
      `Repeated decision signals across ${facts.length} personal facts.`,
    domains: ["Decisions"],
  },
  {
    id: "work_pattern",
    type: "WorkPattern",
    match: (f) =>
      /работ/i.test(contentOf(f)) ||
      /\bwork\b/i.test(contentOf(f)) ||
      /deep\s*work/i.test(contentOf(f)),
    title: "Work pattern detected",
    description: (facts) =>
      `Repeated work-related signals across ${facts.length} personal facts.`,
    domains: ["Preferences", "Tasks", "Projects"],
  },
  {
    id: "company_interest",
    type: "PreferencePattern",
    match: (f) => matchesAny(contentOf(f), COMPANY),
    title: "Repeated company / brand interest",
    description: (facts) =>
      `Repeated company or brand mentions across ${facts.length} personal facts.`,
    domains: ["Preferences", "Knowledge", "Ideas"],
  },
  {
    id: "learning_pattern",
    type: "LearningPattern",
    match: (f) =>
      /учил/i.test(contentOf(f)) ||
      /learn/i.test(contentOf(f)) ||
      /изучаю/i.test(contentOf(f)),
    title: "Learning pattern detected",
    description: (facts) =>
      `Repeated learning signals across ${facts.length} personal facts.`,
    domains: ["Knowledge"],
  },
  {
    id: "relationship_pattern",
    type: "RelationshipPattern",
    match: (f) =>
      f.domain === "Contacts" ||
      /контакт/i.test(contentOf(f)) ||
      /contact/i.test(contentOf(f)),
    title: "Relationship / contact pattern",
    description: (facts) =>
      `Repeated contact signals across ${facts.length} personal facts.`,
    domains: ["Contacts"],
  },
  {
    id: "risk_pattern",
    type: "RiskPattern",
    match: (f) =>
      /риск/i.test(contentOf(f)) ||
      /\brisk\b/i.test(contentOf(f)) ||
      /опасно/i.test(contentOf(f)),
    title: "Risk pattern detected",
    description: (facts) =>
      `Repeated risk signals across ${facts.length} personal facts.`,
    domains: ["Decisions", "Finance", "Health"],
  },
  {
    id: "opportunity_pattern",
    type: "OpportunityPattern",
    match: (f) =>
      /возможност/i.test(contentOf(f)) ||
      /opportunity/i.test(contentOf(f)) ||
      /шанс/i.test(contentOf(f)),
    title: "Opportunity pattern detected",
    description: (facts) =>
      `Repeated opportunity signals across ${facts.length} personal facts.`,
    domains: ["Ideas", "Projects", "Goals"],
  },
]);

/**
 * Apply all rules to an actor's personal facts.
 * @param {PersonalFactLike[]} facts
 * @returns {RuleCandidate[]}
 */
export function applyReasoningRules(facts) {
  const personal = (Array.isArray(facts) ? facts : []).filter(
    (f) => f && f.scope !== "world" && f.id && f.content
  );

  /** @type {RuleCandidate[]} */
  const candidates = [];

  for (const rule of REASONING_RULES) {
    const supporting = personal.filter((f) => rule.match(f));
    if (supporting.length === 0) continue;

    const contradicting = rule.contradict
      ? personal.filter((f) => rule.contradict(f))
      : [];

    candidates.push({
      ruleId: rule.id,
      type: rule.type,
      title: rule.title,
      description: rule.description(supporting),
      factIds: supporting.map((f) => f.id),
      relatedDomains: [
        ...new Set([
          ...rule.domains,
          ...supporting.map((f) => f.domain).filter(Boolean),
        ]),
      ],
      relatedEntities: collectEntities(supporting),
      contradictionFactIds: contradicting.map((f) => f.id),
    });
  }

  return candidates;
}

/**
 * Recommendation drafts from accepted insights (never from raw facts).
 * @param {object[]} insights
 * @returns {object[]}
 */
export function deriveRecommendationDrafts(insights) {
  const list = Array.isArray(insights) ? insights : [];
  /** @type {object[]} */
  const out = [];

  for (const insight of list) {
    if (!insight || insight.status !== "active") continue;

    if (insight.type === "ProductivityPattern") {
      out.push({
        title: "Schedule deep work after 22:00",
        description:
          "Based on the night-productivity insight, protect late-evening focus blocks.",
        insightIds: [insight.id],
        confidence: insight.confidence,
      });
    }

    if (insight.type === "FinancialPattern") {
      out.push({
        title: "Review recurring expenses weekly",
        description:
          "Based on the financial activity pattern, schedule a short weekly spend review.",
        insightIds: [insight.id],
        confidence: insight.confidence,
      });
    }

    if (insight.type === "HabitPattern") {
      out.push({
        title: "Track the habit streak for 7 days",
        description:
          "Based on the habit pattern, make the behavior measurable for one week.",
        insightIds: [insight.id],
        confidence: insight.confidence,
      });
    }

    if (insight.type === "SleepPattern" || insight.type === "HealthPattern") {
      out.push({
        title: "Log sleep and recovery after exercise",
        description:
          "Based on health/sleep insights, capture recovery after workouts to confirm the pattern.",
        insightIds: [insight.id],
        confidence: insight.confidence,
      });
    }

    if (insight.type === "PreferencePattern") {
      out.push({
        title: "Align planning with stated preferences",
        description:
          "Based on preference patterns, bias schedules and tools toward what repeatedly works.",
        insightIds: [insight.id],
        confidence: insight.confidence,
      });
    }

    if (insight.type === "IdeaPattern") {
      out.push({
        title: "Cluster ideas by theme before starting new ones",
        description:
          "Based on idea concentration, group related ideas before opening a new initiative.",
        insightIds: [insight.id],
        confidence: insight.confidence,
      });
    }

    if (insight.type === "GoalPattern" || insight.type === "ProjectPattern") {
      out.push({
        title: "Convert recurring focus into one next action",
        description:
          "Based on repeated goal/project signals, define a single concrete next step.",
        insightIds: [insight.id],
        confidence: insight.confidence,
      });
    }
  }

  return out;
}

function contentOf(fact) {
  return String(fact.normalizedContent || fact.content || "");
}

function matchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

function collectEntities(facts) {
  const out = [];
  for (const f of facts) {
    if (!Array.isArray(f.entities)) continue;
    for (const e of f.entities) {
      const value = typeof e === "string" ? e : e?.value;
      if (value) out.push(String(value));
    }
  }
  return [...new Set(out)].slice(0, 16);
}

function deriveIdeaThemeDescription(facts) {
  const text = facts.map((f) => contentOf(f)).join(" ");
  const ai =
    (text.match(/\bai\b/gi) || []).length +
    (text.match(/искусственн/gi) || []).length +
    (text.match(/нейро/gi) || []).length;
  const fitness =
    (text.match(/fitness/gi) || []).length +
    (text.match(/фитнес/gi) || []).length +
    (text.match(/спорт/gi) || []).length;
  if (ai > fitness && ai > 0) {
    return `Most idea signals (${facts.length} facts) lean toward Artificial Intelligence.`;
  }
  if (fitness > ai && fitness > 0) {
    return `Most idea signals (${facts.length} facts) lean toward Fitness.`;
  }
  return `Idea signals detected across ${facts.length} personal facts.`;
}

/** Exported for tests */
export function normalizeForRuleMatch(text) {
  return normalizeInsightText(text);
}
