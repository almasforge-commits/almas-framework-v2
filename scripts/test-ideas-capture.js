/**
 * Ideas Capture System regressions.
 */

import assert from "node:assert/strict";
import { detectIdea, isStrongIdeaCapture } from "../services/ideas/ideaDetector.js";
import {
  classifyIdeaDeterministic,
  classifyIdea,
} from "../services/ideas/ideaClassifier.js";
import {
  IDEA_CATEGORIES,
  normalizeIdeaCategory,
  normalizeIdeaText,
  ideaCategoryLabelRu,
} from "../services/ideas/ideaContracts.js";
import {
  buildIdeaConfirmationMessage,
} from "../services/ideas/ideaCapture.js";
import {
  formatIdeaList,
  formatIdeaCard,
  formatIdeaSearch,
  formatIdeaSaved,
} from "../services/ideas/ideaFormatters.js";
import { selectRelatedIdeas } from "../services/ideas/ideaRelations.js";
import {
  isIdeasRetrievalQuery,
  isKnowledgeOpenCommand,
  isKnowledgeListCommand,
  extractIdeaCategoryFilter,
  ideaMatchesCategoryFilter,
  normalizeIdeaQueryText,
  classifyIdeasReadIntent,
  isIdeasOpenQuery,
  isIdeasSearchQuery,
} from "../services/ideas/ideaQueryIntent.js";
import { planAnswerRetrieval } from "../services/answer/answerPlanner.js";
import { collectDomainEvidence } from "../services/answer/evidenceCollector.js";
import { createTelegramAnswerEngine } from "../services/answer/telegramAnswerFactory.js";
import { maybeHandleAnswerQuestion } from "../handlers/routes/answerRoute.js";
import { formatAiExecutionConfirmation } from "../handlers/routes/aiExecutionRoute.js";
import { EXECUTABLE_ACTION_TYPES } from "../services/inbox/actionExecutor.js";
import { detectDeterministicIntent } from "../services/inbox/deterministicIntentDetector.js";
import { classifyAnswerRouteIntent } from "../services/answer/answerQuestionGate.js";
import { listRouterActionTypes, getDomain } from "../config/domainRegistry.js";
import {
  handleIdeaCategoryCallback,
  maybeCaptureIdea,
  maybeHandleIdeasExperience,
} from "../handlers/routes/ideaRoute.js";
import { shouldSaveMemory } from "../services/storage/memoryFilter.js";
import { mapIdea } from "../api/mappers/ideaMapper.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(err);
    failed += 1;
  }
}

await test("registry exposes idea_create and executable idea domain", () => {
  assert.ok(listRouterActionTypes().includes("idea_create"));
  assert.equal(getDomain("idea").executable, true);
  assert.deepEqual(getDomain("idea").relatedActionTypes, ["idea_create"]);
  assert.ok(EXECUTABLE_ACTION_TYPES.includes("idea_create"));
});

await test("strong idea detection", () => {
  const d = detectIdea("У меня идея: снять YouTube про кофе во Вьетнаме");
  assert.equal(d.isIdea, true);
  assert.ok(d.confidence >= 0.85);
  assert.match(d.content, /кофе/i);
});

await test("retrieval queries are not treated as idea capture", () => {
  assert.equal(detectIdea("Какие у меня идеи?").isIdea, false);
  assert.equal(detectIdea("Покажи идеи про бизнес").isIdea, false);
});

await test("normalize strips idea prefix", () => {
  assert.equal(
    normalizeIdeaText("У меня идея: запустить подкаст"),
    "Запустить подкаст"
  );
});

await test("deterministic classification picks content/business", () => {
  const c = classifyIdeaDeterministic(
    "Снять YouTube ролик про вьетнамский кофе"
  );
  assert.equal(c.category, "content");
  assert.ok(c.tags.some((t) => /youtube|vietnam|кофе|coffee/i.test(t)));
});

await test("AI classify falls back without network when skipAi", async () => {
  const c = await classifyIdea("Стартап идея для ALMAS", { skipAi: true });
  assert.ok(IDEA_CATEGORIES.includes(c.category));
  assert.equal(c.normalizedText.length > 0, true);
});

await test("confirmation message includes category buttons", () => {
  const msg = buildIdeaConfirmationMessage({
    id: "11111111-1111-4111-8111-111111111111",
    category: "content",
    tags: ["YouTube", "Vietnam"],
  });
  assert.match(msg.text, /Idea saved/);
  assert.match(msg.text, /Open ALMAS/);
  assert.ok(msg.reply_markup.inline_keyboard.length >= 1);
  const flat = msg.reply_markup.inline_keyboard.flat();
  assert.ok(flat.some((b) => b.callback_data.includes("idea:cat:")));
});

await test("deterministic router emits idea_create", () => {
  const c = detectDeterministicIntent(
    "У меня идея: сделать мини-курс по ALMAS"
  );
  assert.ok(c);
  assert.equal(c.actions[0].type, "idea_create");
});

await test("strong ideas are not saved as Memory", () => {
  assert.equal(
    shouldSaveMemory("У меня идея: открыть кафе"),
    false
  );
});

await test("planner routes idea questions to ideas domain", () => {
  const p = planAnswerRetrieval({
    actorKey: "telegram:1",
    query: "Какие у меня идеи про бизнес?",
  });
  assert.equal(p.intent, "ideas_search");
  assert.deepEqual(p.domains, ["ideas"]);
});

await test("planner list vs open subtypes", () => {
  assert.equal(
    planAnswerRetrieval({ actorKey: "telegram:1", query: "Какие у меня идеи" })
      .intent,
    "ideas_list"
  );
  assert.equal(
    planAnswerRetrieval({ actorKey: "telegram:1", query: "Открой идею 2" })
      .intent,
    "ideas_open"
  );
});

await test("ideas evidence mapping", () => {
  const items = collectDomainEvidence("ideas", [
    {
      id: "i1",
      normalizedText: "Снять ролик про кофе",
      category: "content",
      tags: ["YouTube"],
      confidence: 0.8,
      createdAt: "2026-07-20T10:00:00.000Z",
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "ideas");
  assert.equal(items[0].scope, "personal");
  assert.match(items[0].content, /кофе/i);
});

await test("Answer Engine retrieves ideas", async () => {
  const engine = createTelegramAnswerEngine({
    env: {},
    searchIdeasFn: async () => [
      {
        id: "i1",
        normalizedText: "Бизнес идея про кофейню",
        category: "business",
        tags: ["Business"],
        confidence: 0.9,
      },
    ],
    searchMemoryFn: async () => [],
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
  });
  const sent = [];
  await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "Какие у меня идеи?",
      from: { id: 1 },
      actor: { actorKey: "telegram:1" },
    },
    { answerEngine: engine, sendMessageFn: async (_c, t) => sent.push(t) }
  );
  assert.match(sent.join("\n"), /Found|Open in ALMAS/i);
  assert.ok(!/Недостаточно надёжных данных/i.test(sent.join("\n")));
});

await test("AI confirmation formats idea_create with keyboard", () => {
  const formatted = formatAiExecutionConfirmation({
    action: { type: "idea_create", payload: { content: "x" } },
    executed: true,
    reason: "idea_created",
    idea: {
      id: "11111111-1111-4111-8111-111111111111",
      category: "life",
      tags: [],
    },
  });
  assert.equal(typeof formatted, "object");
  assert.match(formatted.text, /Idea saved/);
  assert.ok(formatted.reply_markup);
});

await test("category callback updates existing idea", async () => {
  let updated = null;
  const answered = [];
  const edited = [];
  const ok = await handleIdeaCategoryCallback(
    {
      id: "cb1",
      data: "idea:cat:11111111-1111-4111-8111-111111111111:business",
      from: { id: 42 },
      message: { chat: { id: 9 }, message_id: 3 },
    },
    {
      updateIdeaCategoryFn: async (id, actorKey, category) => {
        updated = { id, actorKey, category };
        return {
          id,
          category,
          tags: ["Business"],
        };
      },
      answerCallbackQueryFn: async (_id, opts) => answered.push(opts),
      editMessageFn: async (chatId, messageId, text, extra) => {
        edited.push({ chatId, messageId, text, extra });
      },
      sendMessageFn: async () => {},
    }
  );
  assert.equal(ok, true);
  assert.equal(updated.category, "business");
  assert.equal(updated.actorKey, "telegram:42");
  assert.ok(edited.length === 1 || answered.length >= 1);
});

await test("category labels cover correction set", () => {
  assert.equal(ideaCategoryLabelRu("content"), "Контент");
  assert.equal(ideaCategoryLabelRu("business"), "Бизнес");
  assert.equal(ideaCategoryLabelRu("project"), "Проект");
  assert.equal(normalizeIdeaCategory("nope"), "other");
});

// --- Regression suite (Telegram Ideas integration bugs) ---

await test("1. Покажи идеи про бизнес routes to Ideas, not Knowledge", () => {
  const text = "Покажи идеи про бизнес";
  assert.equal(isIdeasRetrievalQuery(text), true);
  assert.equal(isKnowledgeOpenCommand(text), false);
  const c = detectDeterministicIntent(text);
  assert.equal(c.reasonCode, "ideas_query");
  assert.equal(c.actions[0].type, "chat");
  const gate = classifyAnswerRouteIntent(text);
  assert.equal(gate.useAnswerEngine, true);
  assert.equal(gate.reason, "ideas_query");
});

await test("2. Найди идеи про бизнес routes to Ideas", () => {
  const text = "Найди идеи про бизнес";
  assert.equal(isIdeasRetrievalQuery(text), true);
  const c = detectDeterministicIntent(text);
  assert.equal(c.reasonCode, "ideas_query");
  assert.equal(classifyAnswerRouteIntent(text).useAnswerEngine, true);
});

await test("3. Покажи знание 3 still routes to Knowledge", () => {
  const text = "Покажи знание 3";
  assert.equal(isIdeasRetrievalQuery(text), false);
  assert.equal(isKnowledgeOpenCommand(text), true);
  const c = detectDeterministicIntent(text);
  assert.equal(c.actions[0].type, "knowledge_query");
  assert.equal(classifyAnswerRouteIntent(text).useAnswerEngine, false);
  assert.equal(isKnowledgeListCommand("Покажи мои знания"), true);
  assert.equal(isKnowledgeListCommand("Мои знания"), true);
  assert.equal(isKnowledgeOpenCommand("Открыть 4"), true);
});

await test("4–6. Voice strong idea saves via same capture path, not Memory", async () => {
  const voiceText =
    "Есть идея создать канал про необычные истории Даркнета";
  assert.equal(isStrongIdeaCapture(voiceText), true);
  assert.equal(shouldSaveMemory(voiceText), false);
  assert.equal(
    detectDeterministicIntent(voiceText).actions[0].type,
    "idea_create"
  );

  let captureCalls = 0;
  let savedSource = null;
  const handled = await maybeCaptureIdea(
    {
      chatId: 1,
      text: voiceText,
      from: { id: 7 },
      actor: { actorKey: "telegram:7" },
      inputSource: "voice",
    },
    {
      skipAi: true,
      sendMessageFn: async () => {},
      captureIdeaFn: async (input) => {
        captureCalls += 1;
        savedSource = input.source;
        return {
          ok: true,
          idea: {
            id: "11111111-1111-4111-8111-111111111111",
            category: "content",
            tags: ["Channel"],
            source: input.source,
          },
        };
      },
    }
  );
  assert.equal(handled.handled, true);
  assert.equal(captureCalls, 1);
  assert.equal(savedSource, "voice");
});

await test("7–9. Ideas list without/with ? and Мои идеи", () => {
  for (const text of [
    "Какие у меня идеи",
    "Какие у меня идеи?",
    "Мои идеи",
  ]) {
    assert.equal(
      normalizeIdeaQueryText(text).includes("?"),
      false,
      text
    );
    assert.equal(isIdeasRetrievalQuery(text), true, text);
    const c = detectDeterministicIntent(text);
    assert.equal(c.reasonCode, "ideas_query", text);
    const gate = classifyAnswerRouteIntent(text);
    assert.equal(gate.useAnswerEngine, true, text);
    assert.equal(gate.reason, "ideas_query", text);
  }
});

await test("10–11. Canonical category equals Telegram label and Answer domain", () => {
  const category = "business";
  const msg = buildIdeaConfirmationMessage({
    id: "11111111-1111-4111-8111-111111111111",
    category,
    tags: [],
  });
  assert.match(msg.text, /Idea saved/);
  const flat = msg.reply_markup.inline_keyboard.flat();
  assert.ok(
    flat.some((b) => b.text.includes(ideaCategoryLabelRu(category)))
  );

  const items = collectDomainEvidence("ideas", [
    {
      id: "i1",
      normalizedText: "Кофейня",
      category: "business",
      tags: [],
      confidence: 0.9,
    },
  ]);
  assert.equal(items[0].domain, "ideas/business");
});

await test("12–13. Category callback updates one row, no duplicate insert", async () => {
  let updateCalls = 0;
  let insertCalls = 0;
  await handleIdeaCategoryCallback(
    {
      id: "cb1",
      data: "idea:cat:11111111-1111-4111-8111-111111111111:content",
      from: { id: 42 },
      message: { chat: { id: 9 }, message_id: 3 },
    },
    {
      updateIdeaCategoryFn: async (id, actorKey, category) => {
        updateCalls += 1;
        return { id, category, tags: [] };
      },
      captureIdeaFn: async () => {
        insertCalls += 1;
        return null;
      },
      answerCallbackQueryFn: async () => {},
      editMessageFn: async () => {},
      sendMessageFn: async () => {},
    }
  );
  assert.equal(updateCalls, 1);
  assert.equal(insertCalls, 0);
});

await test("14. Business filter excludes unrelated categories", () => {
  assert.equal(extractIdeaCategoryFilter("идеи про бизнес"), "business");
  assert.equal(
    ideaMatchesCategoryFilter(
      { category: "sport", normalizedText: "Бег по утрам", tags: [] },
      "business",
      "идеи про бизнес"
    ),
    false
  );
  assert.equal(
    ideaMatchesCategoryFilter(
      { category: "business", normalizedText: "Кофейня", tags: [] },
      "business",
      "идеи про бизнес"
    ),
    true
  );
  assert.equal(
    ideaMatchesCategoryFilter(
      {
        category: "other",
        normalizedText: "Стартап про доставку",
        tags: ["Business"],
      },
      "business",
      "идеи про бизнес"
    ),
    true
  );
});

await test("15. Actor A cannot read actor B ideas (search requires actorKey)", async () => {
  const engine = createTelegramAnswerEngine({
    env: {},
    searchIdeasFn: async (_q, opts) => {
      assert.equal(opts.actorKey, "telegram:1");
      return [
        {
          id: "a1",
          normalizedText: "Idea A",
          category: "life",
          confidence: 0.9,
        },
      ];
    },
    searchMemoryFn: async () => [],
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
  });
  const sent = [];
  await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "Мои идеи",
      from: { id: 1 },
      actor: { actorKey: "telegram:1" },
    },
    { answerEngine: engine, sendMessageFn: async (_c, t) => sent.push(t) }
  );
  assert.match(sent.join("\n"), /Found|Open in ALMAS/i);
});

await test("planner: покажи идеи is ideas-only, not knowledge", () => {
  const p = planAnswerRetrieval({
    actorKey: "telegram:1",
    query: "Покажи идеи про бизнес",
  });
  assert.equal(p.intent, "ideas_search");
  assert.deepEqual(p.domains, ["ideas"]);
  assert.ok(!p.domains.includes("knowledge"));
});

await test("strong patterns include Есть идея / Пришла идея", () => {
  assert.equal(isStrongIdeaCapture("Есть идея открыть кафе"), true);
  assert.equal(isStrongIdeaCapture("Пришла идея снять рилс"), true);
  assert.equal(isStrongIdeaCapture("Пришла мысль: учиться"), true);
  assert.equal(detectIdea("Какие у меня идеи").isIdea, false);
});

await test("captureIdea confirmation is thin and keeps category keyboard", () => {
  const idea = {
    id: "11111111-1111-4111-8111-111111111111",
    category: "business",
    tags: ["Coffee"],
  };
  const conf = buildIdeaConfirmationMessage(idea);
  assert.match(conf.text, /Idea saved/);
  const flat = conf.reply_markup.inline_keyboard.flat();
  assert.ok(flat.some((b) => /Бизнес/.test(b.text) && b.callback_data.includes("business")));
});

// --- D-031 Ideas domain experience ---

await test("D-031 formatIdeaList pagination (>10)", () => {
  const ideas = Array.from({ length: 10 }, (_, i) => ({
    normalizedText: `Идея номер ${i + 1} про тест`,
  }));
  const text = formatIdeaList({ ideas, total: 17, pageSize: 10 });
  assert.match(text, /У тебя 17 идей/);
  assert.match(text, /1\. Идея номер 1/);
  assert.match(text, /10\. Идея номер 10/);
  assert.match(text, /\.\.\.ещё 7/);
  assert.ok(!/11\./.test(text));
});

await test("D-031 formatIdeaCard full fields", () => {
  const card = formatIdeaCard(
    {
      normalizedText: "Снять YouTube про кофе",
      category: "content",
      tags: ["YouTube", "Coffee"],
      confidence: 0.88,
      createdAt: "2026-07-20T10:00:00.000Z",
    },
    {
      index: 2,
      relatedIdeas: [
        { listIndex: 14, title: "Канал про кофейни" },
      ],
    }
  );
  assert.match(card, /Идея 2/);
  assert.match(card, /Название/);
  assert.match(card, /Текст/);
  assert.match(card, /Контент/);
  assert.match(card, /YouTube/);
  assert.match(card, /Создано/);
  assert.match(card, /88%/);
  assert.match(card, /Похожие идеи/);
  assert.match(card, /№14/);
});

await test("D-031 formatIdeaSearch", () => {
  const text = formatIdeaSearch({
    ideas: [
      { normalizedText: "Кофейня", category: "business" },
      { normalizedText: "Darknet канал", category: "content" },
    ],
    category: "business",
    query: "бизнес",
  });
  assert.match(text, /Найдено идей: 2/);
  assert.match(text, /Кофейня/);
});

await test("D-031 formatIdeaSaved UX", () => {
  const msg = formatIdeaSaved({
    id: "11111111-1111-4111-8111-111111111111",
    category: "content",
    tags: ["YouTube"],
  });
  assert.match(msg.text, /Idea saved/);
  assert.match(msg.text, /Open ALMAS/);
  assert.ok(!/Отличная идея/.test(msg.text));
  assert.ok(msg.reply_markup.inline_keyboard.length >= 1);
});

await test("D-031 related ideas selection", () => {
  const { relatedIdeaIds, related } = selectRelatedIdeas({
    text: "YouTube канал про кофе во Вьетнаме",
    category: "content",
    threshold: 0.55,
    candidates: [
      {
        id: "a",
        normalizedText: "Снять ролик про вьетнамский кофе на YouTube",
        category: "content",
        tags: ["YouTube"],
        similarity: 0.81,
      },
      {
        id: "b",
        normalizedText: "Купить гантели",
        category: "sport",
        similarity: 0.1,
      },
    ],
  });
  assert.ok(relatedIdeaIds.includes("a"));
  assert.ok(!relatedIdeaIds.includes("b"));
  assert.equal(related[0].id, "a");
});

await test("D-031 classify list/open/search intents", () => {
  assert.equal(classifyIdeasReadIntent("Какие у меня идеи").kind, "list");
  assert.equal(classifyIdeasReadIntent("Открой идею 2").kind, "open");
  assert.equal(classifyIdeasReadIntent("Открой идею 2").index, 2);
  assert.equal(isIdeasOpenQuery("Покажи идею 5"), true);
  assert.equal(isIdeasOpenQuery("Подробнее про идею 3"), true);
  assert.equal(classifyIdeasReadIntent("Идеи про YouTube").kind, "search");
  assert.equal(isIdeasSearchQuery("Найди идеи про кофе"), true);
  assert.equal(
    classifyIdeasReadIntent("Какие идеи связаны с Вьетнамом").kind,
    "search"
  );
});

await test("D-031 ideas experience list route", async () => {
  const sent = [];
  const result = await maybeHandleIdeasExperience(
    {
      chatId: 1,
      text: "Какие у меня идеи",
      from: { id: 1 },
      actor: { actorKey: "telegram:1" },
    },
    {
      sendMessageFn: async (_c, t) => sent.push(t),
      listFn: async () => ({
        ideas: [
          { normalizedText: "YouTube про кофе во Вьетнаме" },
          { normalizedText: "Канал про Darknet" },
        ],
        total: 2,
        pageSize: 10,
      }),
    }
  );
  assert.equal(result.handled, true);
  assert.equal(result.reason, "ideas_list");
  assert.match(sent.join("\n"), /2 ideas found/);
  assert.match(sent.join("\n"), /Open Ideas/);
  assert.ok(!/🧠 Ответ/.test(sent.join("\n")));
});

await test("D-031 ideas experience open route", async () => {
  const sent = [];
  const result = await maybeHandleIdeasExperience(
    {
      chatId: 1,
      text: "Открой идею 2",
      from: { id: 1 },
      actor: { actorKey: "telegram:1" },
    },
    {
      sendMessageFn: async (_c, t) => sent.push(t),
      getByIndexFn: async () => ({
        idea: {
          id: "i2",
          normalizedText: "Канал про Darknet",
          category: "content",
          tags: ["Darknet"],
          confidence: 0.9,
          createdAt: "2026-07-20T10:00:00.000Z",
          relatedIdeaIds: ["i1"],
        },
        index: 2,
        total: 5,
      }),
    }
  );
  assert.equal(result.handled, true);
  assert.equal(result.reason, "ideas_open");
  assert.match(sent.join("\n"), /Idea ready/);
  assert.match(sent.join("\n"), /Open Ideas/);
});

await test("D-031 ideas experience search route", async () => {
  const sent = [];
  const result = await maybeHandleIdeasExperience(
    {
      chatId: 1,
      text: "Покажи идеи про бизнес",
      from: { id: 1 },
      actor: { actorKey: "telegram:1" },
    },
    {
      sendMessageFn: async (_c, t) => sent.push(t),
      searchFn: async (q, opts) => {
        assert.equal(opts.actorKey, "telegram:1");
        return [
          {
            normalizedText: "Кофейня во Вьетнаме",
            category: "business",
          },
        ];
      },
    }
  );
  assert.equal(result.handled, true);
  assert.equal(result.reason, "ideas_search");
  assert.match(sent.join("\n"), /1 ideas found/);
  assert.ok(!/Укажи номер знания/.test(sent.join("\n")));
});

await test("D-031 actor isolation on experience open", async () => {
  let seenActor = null;
  await maybeHandleIdeasExperience(
    {
      chatId: 1,
      text: "Покажи идею 1",
      from: { id: 99 },
      actor: { actorKey: "telegram:99" },
    },
    {
      sendMessageFn: async () => {},
      getByIndexFn: async (actorKey) => {
        seenActor = actorKey;
        return { idea: null, index: 1, total: 0 };
      },
    }
  );
  assert.equal(seenActor, "telegram:99");
});

await test("D-031 API DTO contains Mini App fields", () => {
  const dto = mapIdea({
    id: "11111111-1111-4111-8111-111111111111",
    normalizedText: "YouTube про кофе",
    originalText: "У меня идея: YouTube про кофе",
    category: "content",
    tags: ["YouTube"],
    confidence: 0.9,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T11:00:00.000Z",
    metadata: { relatedIdeaIds: ["22222222-2222-4222-8222-222222222222"] },
  });
  assert.equal(dto.id, "11111111-1111-4111-8111-111111111111");
  assert.ok(dto.title);
  assert.ok(dto.text);
  assert.equal(dto.category, "content");
  assert.deepEqual(dto.tags, ["YouTube"]);
  assert.ok(dto.createdAt);
  assert.ok(dto.updatedAt);
  assert.equal(dto.confidence, 0.9);
  assert.equal(dto.relatedIdeas[0].id, "22222222-2222-4222-8222-222222222222");
});

await test("D-031 voice path still uses same capture confirmation", async () => {
  const sent = [];
  await maybeCaptureIdea(
    {
      chatId: 1,
      text: "Есть идея создать канал про истории",
      from: { id: 7 },
      actor: { actorKey: "telegram:7" },
      inputSource: "voice",
    },
    {
      skipAi: true,
      sendMessageFn: async (_c, t) => sent.push(t),
      captureIdeaFn: async (input) => ({
        ok: true,
        idea: {
          id: "11111111-1111-4111-8111-111111111111",
          category: "content",
          tags: ["Channel"],
          source: input.source,
        },
      }),
    }
  );
  assert.match(sent.join("\n"), /Idea saved/);
  assert.match(sent.join("\n"), /Open ALMAS/);
});

console.log(`\nideas-capture: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
