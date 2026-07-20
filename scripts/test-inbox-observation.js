import assert from "node:assert/strict";
import {
  mapInputSourceToInboxSourceType,
  startInboxReceivedObservation,
  queueInboxAnalysis,
  queueInboxExecution,
  queueInboxFailure,
  queueInboxDecisionObservation,
  flushInboxObservation,
  resetInboxObservationStateForTests,
} from "../services/inbox/inboxObservation.js";
import { decideRouting } from "../services/inbox/routingDecisionService.js";
import { buildActorFromTelegram } from "../services/inbox/inboxContracts.js";

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((error) => {
      console.error(`❌ ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

function makeFakeDriver() {
  const calls = [];
  return {
    calls,
    createReceivedInboxItemFn: async (input) => {
      calls.push({ op: "create", at: calls.length, input });
      return { success: true, skipped: false, item: { ...input, status: "received" } };
    },
    recordInboxAnalysisFn: async (requestKey, analysis) => {
      calls.push({ op: "analysis", at: calls.length, requestKey, analysis });
      return { success: true, skipped: false, item: { requestKey, status: "analyzed" } };
    },
    extractUniversalInformationFn: async (text) => {
      calls.push({ op: "extraction", at: calls.length, text });
      return {
        tier: "deterministic",
        reasonCode: "test",
        language: "ru",
        needsClarification: false,
        truncated: false,
        itemCount: 0,
        items: [],
      };
    },
    recordInboxUniversalExtractionFn: async (requestKey, extraction) => {
      calls.push({ op: "extraction_record", at: calls.length, requestKey, extraction });
      return { success: true, skipped: false, item: { requestKey } };
    },
    recordInboxExecutionFn: async (requestKey, execution) => {
      calls.push({ op: "execution", at: calls.length, requestKey, execution });
      return { success: true, skipped: false, item: { requestKey, status: "executed" } };
    },
    recordInboxFailureFn: async (requestKey, errorCode) => {
      calls.push({ op: "failure", at: calls.length, requestKey, errorCode });
      return { success: true, skipped: false, item: { requestKey, status: "failed" } };
    },
  };
}

async function run() {
  resetInboxObservationStateForTests();

  await test("text maps to telegram_text; voice maps to telegram_voice", () => {
    assert.equal(mapInputSourceToInboxSourceType("text"), "telegram_text");
    assert.equal(mapInputSourceToInboxSourceType(undefined), "telegram_text");
    assert.equal(mapInputSourceToInboxSourceType("voice"), "telegram_voice");
  });

  await test("disabled mode: zero driver calls and zero logs", async () => {
    resetInboxObservationStateForTests();
    const fake = makeFakeDriver();
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(" "));

    try {
      startInboxReceivedObservation(
        {
          requestKey: "rk-disabled",
          sourceType: "telegram_text",
          actor: buildActorFromTelegram({ id: 1 }, 10),
          originalText: "hi",
          normalizedText: "hi",
        },
        // forceEnabled omitted → real isInboxEnabled() is false by default
        { ...fake }
      );
      queueInboxAnalysis("rk-disabled", { routingDecision: { actions: [] } }, { ...fake });
      queueInboxExecution("rk-disabled", { results: [] }, { ...fake });
      await flushInboxObservation("rk-disabled");
      assert.equal(fake.calls.length, 0);
      assert.equal(errors.length, 0);
    } finally {
      console.error = originalError;
    }
  });

  await test("received → analysis → execution order is preserved", async () => {
    resetInboxObservationStateForTests();
    const fake = makeFakeDriver();
    const requestKey = "rk-order";
    const actor = buildActorFromTelegram({ id: 42, username: "same" }, 99);

    // Start received, then immediately queue analysis+execution (simulates
    // decideRouting finishing before create resolves).
    let releaseCreate;
    const createGate = new Promise((resolve) => {
      releaseCreate = resolve;
    });

    const slowFake = {
      ...fake,
      forceEnabled: true,
      createReceivedInboxItemFn: async (input) => {
        await createGate;
        return fake.createReceivedInboxItemFn(input);
      },
    };

    startInboxReceivedObservation(
      {
        requestKey,
        sourceType: "telegram_text",
        actor,
        originalText: "Завтра купить батарейки",
        normalizedText: "Завтра купить батарейки",
        metadata: { inputSource: "text", messageId: 7 },
      },
      slowFake
    );

    queueInboxAnalysis(
      requestKey,
      {
        routingDecision: { actions: [{ type: "task_create" }], language: "ru" },
        normalizedText: "Завтра купить батарейки",
        sourceType: "telegram_text",
      },
      slowFake
    );
    queueInboxExecution(
      requestKey,
      { results: [{ executed: true, reason: "task_created" }], executedCount: 1, skippedCount: 0 },
      slowFake
    );

    // Analysis/execution must not have run before create is released.
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(
      fake.calls.filter((c) => c.op === "analysis" || c.op === "execution").length,
      0,
      "update must not run before insert"
    );

    releaseCreate();
    await flushInboxObservation(requestKey);

    assert.deepEqual(
      fake.calls.map((c) => c.op),
      ["create", "analysis", "execution"]
    );
    assert.equal(fake.calls[0].input.sourceType, "telegram_text");
    assert.equal(fake.calls[0].input.actor.actorKey, "telegram:42");
  });

  await test("voice sourceType and safe metadata only", async () => {
    resetInboxObservationStateForTests();
    const fake = makeFakeDriver();
    const requestKey = "rk-voice";

    startInboxReceivedObservation(
      {
        requestKey,
        sourceType: mapInputSourceToInboxSourceType("voice"),
        actor: buildActorFromTelegram({ id: 5 }, 1),
        originalText: "потратил сорок тысяч",
        normalizedText: "потратил сорок тысяч",
        metadata: { inputSource: "voice", messageId: 55 },
      },
      { ...fake, forceEnabled: true }
    );
    await flushInboxObservation(requestKey);

    assert.equal(fake.calls[0].input.sourceType, "telegram_voice");
    assert.deepEqual(fake.calls[0].input.metadata, {
      inputSource: "voice",
      messageId: 55,
    });
    assert.equal(fake.calls[0].input.metadata.fileUrl, undefined);
    assert.equal(fake.calls[0].input.metadata.tempPath, undefined);
  });

  await test("persistence failure is swallowed and logged once per requestKey", async () => {
    resetInboxObservationStateForTests();
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(" "));

    try {
      const requestKey = "rk-fail";
      const deps = {
        forceEnabled: true,
        createReceivedInboxItemFn: async () => {
          throw new Error("db down");
        },
        recordInboxAnalysisFn: async () => ({
          success: false,
          skipped: false,
          errorCode: "inbox_analysis_failed",
        }),
        recordInboxExecutionFn: async () => ({
          success: false,
          skipped: false,
          errorCode: "inbox_execution_failed",
        }),
      };

      startInboxReceivedObservation(
        {
          requestKey,
          sourceType: "telegram_text",
          actor: buildActorFromTelegram({ id: 1 }, 1),
          originalText: "x",
          normalizedText: "x",
        },
        deps
      );
      queueInboxAnalysis(requestKey, { routingDecision: { actions: [] } }, deps);
      queueInboxExecution(requestKey, { results: [] }, deps);
      await flushInboxObservation(requestKey);

      assert.equal(errors.length, 1, "at most one sanitized error line");
      assert.match(errors[0], /\[inbox\] persist failed requestKey=rk-fail/);
      assert.doesNotMatch(errors[0], /db down/);
      assert.doesNotMatch(errors[0], /originalText|embedding|stack/i);
    } finally {
      console.error = originalError;
    }
  });

  await test("queueInboxDecisionObservation preserves decision shape and orders analysis→execution", async () => {
    resetInboxObservationStateForTests();
    const fake = makeFakeDriver();
    const decision = {
      mode: "shadow",
      tier: "deterministic",
      language: "ru",
      actions: [{ type: "task_create", confidence: 0.9 }],
      needsClarification: false,
      execution: [{ action: { type: "task_create" }, executed: false, reason: "skipped_shadow_mode" }],
      executedCount: 0,
      skippedCount: 1,
    };
    const snapshot = JSON.stringify(decision);

    startInboxReceivedObservation(
      {
        requestKey: "rk-decision",
        sourceType: "telegram_text",
        actor: buildActorFromTelegram({ id: 9 }, 1),
        originalText: "task",
        normalizedText: "task",
      },
      { ...fake, forceEnabled: true }
    );

    queueInboxDecisionObservation(
      "rk-decision",
      decision,
      { sourceType: "telegram_text", normalizedText: "task" },
      { ...fake, forceEnabled: true }
    );

    await flushInboxObservation("rk-decision");

    assert.equal(JSON.stringify(decision), snapshot, "decision object must be unchanged");
    assert.deepEqual(
      fake.calls.map((c) => c.op),
      ["create", "analysis", "extraction", "extraction_record", "execution"]
    );
  });

  await test("decideRouting queues Inbox observation without changing decision; failure queues routing_failed", async () => {
    resetInboxObservationStateForTests();
    const fake = makeFakeDriver();
    const requestKey = "rk-router";

    startInboxReceivedObservation(
      {
        requestKey,
        sourceType: "telegram_text",
        actor: buildActorFromTelegram({ id: 3 }, 1),
        originalText: "баланс",
        normalizedText: "баланс",
      },
      { ...fake, forceEnabled: true }
    );

    const decision = await decideRouting("баланс", {
      requestKey,
      sourceType: "telegram_text",
      normalizedText: "баланс",
      inputSource: "text",
      configOverrides: { enabled: true, mode: "shadow" },
      executeActionsFn: async (actions) => ({
        results: actions.map((action) => ({
          action,
          executed: false,
          reason: "skipped_shadow_mode",
        })),
        executedCount: 0,
        skippedCount: actions.length,
      }),
      inboxDeps: { ...fake, forceEnabled: true },
    });

    assert.equal(decision.skipped, undefined);
    assert.ok(Array.isArray(decision.actions));
    assert.ok(Array.isArray(decision.execution));
    assert.equal(typeof decision.mode, "string");

    await flushInboxObservation(requestKey);
    assert.deepEqual(
      fake.calls.map((c) => c.op),
      ["create", "analysis", "extraction", "extraction_record", "execution"]
    );

    // Failure path
    resetInboxObservationStateForTests();
    const failFake = makeFakeDriver();
    const failKey = "rk-router-fail";
    startInboxReceivedObservation(
      {
        requestKey: failKey,
        sourceType: "telegram_text",
        actor: buildActorFromTelegram({ id: 3 }, 1),
        originalText: "x",
        normalizedText: "x",
      },
      { ...failFake, forceEnabled: true }
    );

    await assert.rejects(
      () =>
        decideRouting("баланс", {
          requestKey: failKey,
          sourceType: "telegram_text",
          normalizedText: "баланс",
          configOverrides: { enabled: true, mode: "shadow" },
          executeActionsFn: async () => {
            throw new Error("executor boom");
          },
          inboxDeps: { ...failFake, forceEnabled: true },
        }),
      /executor boom/
    );

    await flushInboxObservation(failKey);
    assert.ok(
      failFake.calls.some((c) => c.op === "failure" && c.errorCode === "routing_failed"),
      "routing_failed must be queued"
    );
  });

  await test("Inbox failure does not block decideRouting success path", async () => {
    resetInboxObservationStateForTests();
    const requestKey = "rk-nonblock";

    const decision = await decideRouting("баланс", {
      requestKey,
      sourceType: "telegram_text",
      normalizedText: "баланс",
      configOverrides: { enabled: true, mode: "shadow" },
      executeActionsFn: async (actions) => ({
        results: actions.map((a) => ({ action: a, executed: false, reason: "skipped_shadow_mode" })),
        executedCount: 0,
        skippedCount: actions.length,
      }),
      inboxDeps: {
        forceEnabled: true,
        extractUniversalInformationFn: async () => ({ items: [], itemCount: 0 }),
        recordInboxUniversalExtractionFn: async () => ({ success: true, skipped: false }),
        recordInboxAnalysisFn: async () => {
          throw new Error("inbox down");
        },
        recordInboxExecutionFn: async () => {
          throw new Error("inbox down");
        },
      },
    });

    assert.ok(decision);
    assert.ok(Array.isArray(decision.actions));
    await flushInboxObservation(requestKey);
  });

  if (process.exitCode) console.error("\nSome inbox-observation tests failed.");
  else console.log("\nAll inbox-observation tests passed.");
}

run();
