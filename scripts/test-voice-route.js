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

  if (process.exitCode) {
    console.error("\nSome voiceRoute tests failed.");
  } else {
    console.log("\nAll voiceRoute tests passed.");
  }

}

run();
