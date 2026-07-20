import assert from "node:assert/strict";

import { transcribeAudio } from "../services/ai/transcriptionService.js";

// transcribeAudio always receives an injected createTranscriptionFn and/or
// createReadStreamFn in these tests — the real OpenAI client is never
// constructed and no network call is ever made.

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

function fakeReadStream(path) {
  return { __fakeStream: true, path };
}

async function run() {

  await test("transcribeAudio rejects a missing filePath", async () => {
    await assert.rejects(
      () => transcribeAudio(undefined, { createTranscriptionFn: async () => ({ text: "x" }) }),
      /filePath is required/
    );
  });

  await test("transcribeAudio rejects a non-string filePath", async () => {
    await assert.rejects(
      () => transcribeAudio(123, { createTranscriptionFn: async () => ({ text: "x" }) }),
      /filePath is required/
    );
  });

  await test("transcribeAudio returns trimmed text on success", async () => {
    const text = await transcribeAudio("/tmp/fake.ogg", {
      createTranscriptionFn: async () => ({ text: "  hello world  " }),
      createReadStreamFn: fakeReadStream,
    });

    assert.equal(text, "hello world");
  });

  await test("transcribeAudio returns null when the response text is empty", async () => {
    const text = await transcribeAudio("/tmp/fake.ogg", {
      createTranscriptionFn: async () => ({ text: "" }),
      createReadStreamFn: fakeReadStream,
    });

    assert.equal(text, null);
  });

  await test("transcribeAudio returns null when the response text is whitespace-only", async () => {
    const text = await transcribeAudio("/tmp/fake.ogg", {
      createTranscriptionFn: async () => ({ text: "   " }),
      createReadStreamFn: fakeReadStream,
    });

    assert.equal(text, null);
  });

  await test("transcribeAudio returns null when the response has no text field", async () => {
    const text = await transcribeAudio("/tmp/fake.ogg", {
      createTranscriptionFn: async () => ({}),
      createReadStreamFn: fakeReadStream,
    });

    assert.equal(text, null);
  });

  await test("transcribeAudio wraps and rethrows errors from createTranscriptionFn with model context", async () => {
    await assert.rejects(
      () =>
        transcribeAudio("/tmp/fake.ogg", {
          model: "whisper-1",
          createTranscriptionFn: async () => {
            throw new Error("network down");
          },
          createReadStreamFn: fakeReadStream,
        }),
      /transcribeAudio failed \(model=whisper-1\): network down/
    );
  });

  await test("transcribeAudio uses the provided model option instead of the default", async () => {
    let receivedModel = null;

    await transcribeAudio("/tmp/fake.ogg", {
      model: "gpt-4o-mini-transcribe",
      createTranscriptionFn: async (params) => {
        receivedModel = params.model;
        return { text: "ok" };
      },
      createReadStreamFn: fakeReadStream,
    });

    assert.equal(receivedModel, "gpt-4o-mini-transcribe");
  });

  await test("transcribeAudio requests Russian ('ru') by default", async () => {
    let receivedLanguage = null;

    await transcribeAudio("/tmp/fake.ogg", {
      createTranscriptionFn: async (params) => {
        receivedLanguage = params.language;
        return { text: "ok" };
      },
      createReadStreamFn: fakeReadStream,
    });

    assert.equal(receivedLanguage, "ru");
  });

  await test("transcribeAudio uses the provided language option instead of the default", async () => {
    let receivedLanguage = null;

    await transcribeAudio("/tmp/fake.ogg", {
      language: "en",
      createTranscriptionFn: async (params) => {
        receivedLanguage = params.language;
        return { text: "ok" };
      },
      createReadStreamFn: fakeReadStream,
    });

    assert.equal(receivedLanguage, "en");
  });

  await test("transcribeAudio omits the language param when explicitly passed as an empty string", async () => {
    let params = null;

    await transcribeAudio("/tmp/fake.ogg", {
      language: "",
      createTranscriptionFn: async (p) => {
        params = p;
        return { text: "ok" };
      },
      createReadStreamFn: fakeReadStream,
    });

    assert.equal(Object.prototype.hasOwnProperty.call(params, "language"), false);
  });

  await test("transcribeAudio passes filePath through createReadStreamFn", async () => {
    let receivedPath = null;

    await transcribeAudio("/tmp/some-file.ogg", {
      createTranscriptionFn: async (params) => {
        receivedPath = params.file.path;
        return { text: "ok" };
      },
      createReadStreamFn: fakeReadStream,
    });

    assert.equal(receivedPath, "/tmp/some-file.ogg");
  });

  await test("transcribeAudio never calls the real OpenAI client when fully injected", async () => {
    // If this test reached the real OpenAI client (no API key set here),
    // constructing/calling it would throw a different, unrelated error.
    const text = await transcribeAudio("/tmp/fake.ogg", {
      createTranscriptionFn: async () => ({ text: "safe" }),
      createReadStreamFn: fakeReadStream,
    });

    assert.equal(text, "safe");
  });

  if (process.exitCode) {
    console.error("\nSome transcriptionService tests failed.");
  } else {
    console.log("\nAll transcriptionService tests passed.");
  }

}

run();
