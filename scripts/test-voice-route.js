import assert from "node:assert/strict";

import {
  handleVoiceMessage,
  MAX_VOICE_DURATION_SECONDS,
  MAX_VOICE_FILE_SIZE_BYTES,
} from "../handlers/routes/voiceRoute.js";

// handleVoiceMessage always receives injected getFileLinkFn/downloadFn/
// writeFileFn/unlinkFn/transcribeFn/sendMessageFn in these tests — no real
// Telegram API call, no real OpenAI call, and no real filesystem I/O ever
// happens here.
//
// Router integration note: handleVoiceMessage() itself does NOT call
// routeText() — that wiring (and the voice destructive-command safety
// guard) lives in handlers/messageHandler.js's bot.on("message", ...)
// listener and inside routeText() itself, per the approved plan. This file
// tests handleVoiceMessage()'s side of that contract: it must return the
// recognized text on success (so the listener can pass it to routeText())
// and null on any rejection/failure (so the listener stops without
// routing). The listener-side wiring and the destructive-command guard are
// covered by scripts/test-message-router-extraction.js, via source-level
// regression checks — messageHandler.js cannot be safely imported/executed
// in isolated tests (it constructs a real polling bot and real Supabase
// clients at import time, and the bot import is intentionally not made
// lazy in this task).

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      console.log(`✅ ${name}`);
    } catch (error) {
      console.error(`❌ ${name}`);
      console.error(error);
      process.exitCode = 1;
    }
  })();
}

function spy() {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return fn.impl ? fn.impl(...args) : undefined;
  };
  fn.calls = calls;
  return fn;
}

function baseDeps(overrides = {}) {
  const sendMessageFn = spy();
  const getFileLinkFn = spy();
  getFileLinkFn.impl = async () => "https://telegram.example/file.ogg";

  const downloadFn = spy();
  downloadFn.impl = async () => Buffer.from("fake-audio-bytes");

  const writeFileFn = spy();
  const unlinkFn = spy();

  const transcribeFn = spy();
  transcribeFn.impl = async () => "привет мир";

  return {
    getFileLinkFn,
    downloadFn,
    writeFileFn,
    unlinkFn,
    transcribeFn,
    sendMessageFn,
    tmpDir: "/tmp/almas-test",
    randomIdFn: () => "fixed-id",
    ...overrides,
  };
}

async function run() {

  await test("rejects (no download) when duration exceeds the limit", async () => {
    const deps = baseDeps();
    const result = await handleVoiceMessage(
      1,
      { file_id: "f1", duration: MAX_VOICE_DURATION_SECONDS + 1 },
      deps
    );

    assert.equal(result, null);
    assert.equal(deps.getFileLinkFn.calls.length, 0);
    assert.equal(deps.downloadFn.calls.length, 0);
    assert.equal(deps.sendMessageFn.calls.length, 1);
    assert.match(deps.sendMessageFn.calls[0][1], /длинное/);
  });

  await test("rejects (no download) when file_size metadata exceeds the limit", async () => {
    const deps = baseDeps();
    const result = await handleVoiceMessage(
      1,
      { file_id: "f1", duration: 5, file_size: MAX_VOICE_FILE_SIZE_BYTES + 1 },
      deps
    );

    assert.equal(result, null);
    assert.equal(deps.getFileLinkFn.calls.length, 0);
    assert.equal(deps.downloadFn.calls.length, 0);
    assert.equal(deps.sendMessageFn.calls.length, 1);
    assert.match(deps.sendMessageFn.calls[0][1], /большое/);
  });

  await test("returns null with no side effects when voice/file_id is missing", async () => {
    const deps = baseDeps();
    const result = await handleVoiceMessage(1, null, deps);

    assert.equal(result, null);
    assert.equal(deps.sendMessageFn.calls.length, 0);
  });

  await test("successful path: downloads, transcribes, sends recognized text, cleans up", async () => {
    const deps = baseDeps();

    const result = await handleVoiceMessage(
      42,
      { file_id: "f1", duration: 10, file_size: 1000 },
      deps
    );

    assert.equal(result, "привет мир");
    assert.equal(deps.getFileLinkFn.calls.length, 1);
    assert.equal(deps.downloadFn.calls.length, 1);
    assert.equal(deps.writeFileFn.calls.length, 1);
    assert.equal(deps.transcribeFn.calls.length, 1);
    assert.equal(deps.unlinkFn.calls.length, 1);

    const [tempPathWritten] = deps.writeFileFn.calls[0];
    const [tempPathUnlinked] = deps.unlinkFn.calls[0];
    assert.equal(tempPathWritten, tempPathUnlinked);
    assert.match(tempPathWritten, /almas-voice-fixed-id\.ogg$/);

    assert.equal(deps.sendMessageFn.calls.length, 1);
    assert.equal(deps.sendMessageFn.calls[0][0], 42);
    assert.equal(deps.sendMessageFn.calls[0][1], "🎙 Распознано:\n\nпривет мир");
  });

  await test("does not route/execute the recognized text as a command (Phase 1 scope)", async () => {
    const deps = baseDeps();

    await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    // Only one outbound message is ever sent: the transparency message.
    // No router/command function is invoked by handleVoiceMessage itself.
    assert.equal(deps.sendMessageFn.calls.length, 1);
    assert.match(deps.sendMessageFn.calls[0][1], /^🎙 Распознано:/);
  });

  await test("getFileLinkFn failure sends a download error and never writes/transcribes/unlinks", async () => {
    const deps = baseDeps();
    deps.getFileLinkFn.impl = async () => {
      throw new Error("telegram down");
    };

    const result = await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    assert.equal(result, null);
    assert.equal(deps.writeFileFn.calls.length, 0);
    assert.equal(deps.transcribeFn.calls.length, 0);
    assert.equal(deps.unlinkFn.calls.length, 0);
    assert.match(deps.sendMessageFn.calls[0][1], /загрузить/);
  });

  await test("downloadFn failure sends a download error and never writes/transcribes/unlinks", async () => {
    const deps = baseDeps();
    deps.downloadFn.impl = async () => {
      throw new Error("connection reset");
    };

    const result = await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    assert.equal(result, null);
    assert.equal(deps.writeFileFn.calls.length, 0);
    assert.equal(deps.transcribeFn.calls.length, 0);
    assert.equal(deps.unlinkFn.calls.length, 0);
    assert.match(deps.sendMessageFn.calls[0][1], /загрузить/);
  });

  await test("re-checks actual downloaded size and rejects an oversized buffer without writing", async () => {
    const deps = baseDeps();
    deps.downloadFn.impl = async () => Buffer.alloc(MAX_VOICE_FILE_SIZE_BYTES + 1);

    const result = await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    assert.equal(result, null);
    assert.equal(deps.writeFileFn.calls.length, 0);
    assert.equal(deps.unlinkFn.calls.length, 0);
    assert.match(deps.sendMessageFn.calls[0][1], /большое/);
  });

  await test("transcribeFn throwing sends a transcribe error, but still cleans up the temp file", async () => {
    const deps = baseDeps();
    deps.transcribeFn.impl = async () => {
      throw new Error("openai down");
    };

    const result = await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    assert.equal(result, null);
    assert.equal(deps.writeFileFn.calls.length, 1);
    assert.equal(deps.unlinkFn.calls.length, 1);
    assert.match(deps.sendMessageFn.calls[0][1], /распознать/);
  });

  await test("transcribeFn returning null/empty sends a transcribe error, but still cleans up", async () => {
    const deps = baseDeps();
    deps.transcribeFn.impl = async () => null;

    const result = await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    assert.equal(result, null);
    assert.equal(deps.unlinkFn.calls.length, 1);
    assert.match(deps.sendMessageFn.calls[0][1], /распознать/);
  });

  await test("rejects a garbage/wrong-script transcript, sends low-confidence message, never sends the recognized text (reported bug)", async () => {
    const deps = baseDeps();
    deps.transcribeFn.impl = async () => "შიჵმხტი მუემიში";

    const result = await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    assert.equal(result, null);
    assert.equal(deps.sendMessageFn.calls.length, 1);
    assert.equal(
      deps.sendMessageFn.calls[0][1],
      "❌ Не удалось уверенно распознать речь. Попробуйте сказать ещё раз."
    );
    assert.ok(!deps.sendMessageFn.calls[0][1].includes("Распознано"));
    assert.ok(!deps.sendMessageFn.calls[0][1].includes("შიჵმხტი"));
    // Cleanup still happens even on a rejected transcript.
    assert.equal(deps.unlinkFn.calls.length, 1);
  });

  await test("accepts a Russian transcript with digits and forwards it unchanged", async () => {
    const deps = baseDeps();
    deps.transcribeFn.impl = async () => "расход 40000 кофе";

    const result = await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    assert.equal(result, "расход 40000 кофе");
    assert.equal(deps.sendMessageFn.calls[0][1], "🎙 Распознано:\n\nрасход 40000 кофе");
  });

  await test("collapses internal whitespace/newlines in the transcript before validating/routing", async () => {
    const deps = baseDeps();
    deps.transcribeFn.impl = async () => "  привет   мир\n\nкак дела  ";

    const result = await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    assert.equal(result, "привет мир как дела");
    assert.equal(deps.sendMessageFn.calls[0][1], "🎙 Распознано:\n\nпривет мир как дела");
  });

  await test("cleanup happens even when unlinkFn itself throws (never propagates)", async () => {
    const deps = baseDeps();
    deps.unlinkFn.impl = async () => {
      throw new Error("permission denied");
    };

    const result = await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    assert.equal(result, "привет мир");
    assert.equal(deps.unlinkFn.calls.length, 1);
  });

  await test("no technical error text ever reaches sendMessageFn", async () => {
    const deps = baseDeps();
    deps.downloadFn.impl = async () => {
      throw new Error("ECONNRESET some very technical detail");
    };

    await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);

    const [, message] = deps.sendMessageFn.calls[0];
    assert.ok(!message.includes("ECONNRESET"));
  });

  await test("return contract: successful transcription returns the recognized text (ready for the listener to route)", async () => {
    const deps = baseDeps();
    deps.transcribeFn.impl = async () => "купи хлеб и молоко";

    const result = await handleVoiceMessage(
      1,
      { file_id: "f1", duration: 10 },
      deps
    );

    assert.equal(typeof result, "string");
    assert.equal(result, "купи хлеб и молоко");
  });

  await test("return contract: every rejection/failure path returns null (so the listener never routes it)", async () => {
    const rejectionScenarios = [
      (deps) => { deps.transcribeFn.impl = async () => null; },
      (deps) => { deps.transcribeFn.impl = async () => { throw new Error("x"); }; },
      (deps) => { deps.downloadFn.impl = async () => { throw new Error("x"); }; },
      (deps) => { deps.getFileLinkFn.impl = async () => { throw new Error("x"); }; },
      (deps) => { deps.transcribeFn.impl = async () => "შიჵმხტი მუემიში"; },
      (deps) => { deps.transcribeFn.impl = async () => "   "; },
    ];

    for (const applyScenario of rejectionScenarios) {
      const deps = baseDeps();
      applyScenario(deps);

      const result = await handleVoiceMessage(1, { file_id: "f1", duration: 10 }, deps);
      assert.equal(result, null);
    }

    // Metadata-limit rejections (no download attempted at all).
    const deps = baseDeps();
    const overLimitResult = await handleVoiceMessage(
      1,
      { file_id: "f1", duration: MAX_VOICE_DURATION_SECONDS + 1 },
      deps
    );
    assert.equal(overLimitResult, null);
  });

  if (process.exitCode) {
    console.error("\nSome voiceRoute tests failed.");
  } else {
    console.log("\nAll voiceRoute tests passed.");
  }

}

run();
