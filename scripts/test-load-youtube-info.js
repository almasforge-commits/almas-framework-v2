import assert from "node:assert/strict";

import { loadYouTubeInfo } from "../core/pipeline/steps/loadYouTubeInfo.js";

// loadYouTubeInfo normally calls the real getYouTubeVideoInfo (network call
// via youtubei.js). For isolated tests we inject a fake via the optional
// `options.getYouTubeVideoInfoFn` dependency, so no network/YouTube access
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

function baseContext(overrides = {}) {
  return {
    input: { url: "https://youtube.com/watch?v=abc123" },
    metadata: {},
    ...overrides,
  };
}

async function run() {

  await test("loadYouTubeInfo populates context.metadata.source with the normalized contract", async () => {
    const context = baseContext();
    const fakeInfo = { title: "Test Video", channel: "Test Channel", duration: "10:00" };

    const result = await loadYouTubeInfo(context, {
      getYouTubeVideoInfoFn: async (url) => {
        assert.equal(url, "https://youtube.com/watch?v=abc123");
        return fakeInfo;
      },
    });

    assert.deepEqual(result.metadata.source, {
      type: "youtube",
      title: "Test Video",
      url: "https://youtube.com/watch?v=abc123",
      author: "Test Channel",
      duration: "10:00",
      extra: {},
    });
  });

  await test("loadYouTubeInfo does not set context.metadata.video anymore", async () => {
    const context = baseContext();
    const result = await loadYouTubeInfo(context, {
      getYouTubeVideoInfoFn: async () => ({
        title: "T",
        channel: "C",
        duration: "1:00",
      }),
    });

    assert.equal(result.metadata.video, undefined);
  });

  await test("loadYouTubeInfo throws VIDEO_INFO_FAILED when info lookup returns null", async () => {
    const context = baseContext();

    await assert.rejects(
      () => loadYouTubeInfo(context, { getYouTubeVideoInfoFn: async () => null }),
      /VIDEO_INFO_FAILED/
    );
  });

  await test("loadYouTubeInfo returns the same context object it was given", async () => {
    const context = baseContext();
    const result = await loadYouTubeInfo(context, {
      getYouTubeVideoInfoFn: async () => ({
        title: "T",
        channel: "C",
        duration: "1:00",
      }),
    });

    assert.equal(result, context);
  });

  await test("loadYouTubeInfo maps missing channel/title/duration to empty-ish values as provided", async () => {
    const context = baseContext();
    const result = await loadYouTubeInfo(context, {
      getYouTubeVideoInfoFn: async () => ({ title: "", channel: "", duration: "0:00" }),
    });

    assert.equal(result.metadata.source.title, "");
    assert.equal(result.metadata.source.author, "");
    assert.equal(result.metadata.source.duration, "0:00");
  });

  if (process.exitCode) {
    console.error("\nSome loadYouTubeInfo tests failed.");
  } else {
    console.log("\nAll loadYouTubeInfo tests passed.");
  }

}

run();
