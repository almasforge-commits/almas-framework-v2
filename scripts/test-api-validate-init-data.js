import assert from "node:assert/strict";
import {
  validateInitData,
  signInitDataForTests,
  safeEqualStrings,
} from "../api/auth/validateInitData.js";

const BOT = "123456:ABC-DEF";

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function makeValid(overrides = {}, nowSec = Math.floor(Date.now() / 1000)) {
  return signInitDataForTests(
    {
      auth_date: String(nowSec),
      user: JSON.stringify({ id: 42, first_name: "Almas", username: "almas" }),
      query_id: "AAE",
      ...overrides,
    },
    BOT
  );
}

function run() {
  test("official valid Telegram HMAC example generated in test", () => {
    const raw = makeValid();
    const result = validateInitData(raw, BOT);
    assert.equal(result.ok, true);
    assert.equal(result.actor.telegramUserId, 42);
    assert.equal(result.actor.actorKey, "telegram:42");
    assert.equal(result.actor.userId, "42");
  });

  test("tampered user JSON rejected", () => {
    const params = new URLSearchParams(makeValid());
    params.set("user", JSON.stringify({ id: 999, first_name: "Hacker" }));
    const result = validateInitData(params.toString(), BOT);
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_signature");
  });

  test("tampered auth_date rejected", () => {
    const params = new URLSearchParams(makeValid());
    params.set("auth_date", String(Math.floor(Date.now() / 1000) - 10));
    const result = validateInitData(params.toString(), BOT);
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_signature");
  });

  test("expired auth_date rejected", () => {
    const old = Math.floor(Date.now() / 1000) - 48 * 60 * 60;
    const raw = makeValid({}, old);
    const result = validateInitData(raw, BOT, { maxAgeSeconds: 24 * 60 * 60 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "expired_init_data");
  });

  test("future auth_date outside skew rejected", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const raw = makeValid({}, future);
    const result = validateInitData(raw, BOT, { clockSkewSeconds: 60 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "future_auth_date");
  });

  test("missing user rejected", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const raw = signInitDataForTests(
      { auth_date: String(nowSec), query_id: "x" },
      BOT
    );
    const result = validateInitData(raw, BOT);
    assert.equal(result.ok, false);
    assert.equal(result.code, "missing_user");
  });

  test("malformed percent encoding rejected safely", () => {
    // Broken escape sequences must not throw.
    const result = validateInitData("user=%E0%A4%A&hash=abc&auth_date=1", BOT);
    assert.equal(result.ok, false);
    assert.ok(typeof result.code === "string");
  });

  test("timing-safe comparison handles different byte lengths safely", () => {
    assert.equal(safeEqualStrings("abc", "abcd"), false);
    assert.equal(safeEqualStrings("abcd", "abcd"), true);
    assert.doesNotThrow(() => safeEqualStrings("", "x"));
  });

  test("validateInitData errors never include raw initData", () => {
    const raw = makeValid();
    const result = validateInitData(raw + "x", BOT);
    assert.equal(result.ok, false);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("auth_date="));
    assert.ok(!serialized.includes(BOT));
    assert.ok(!("message" in result));
  });

  if (process.exitCode) {
    console.error("\nvalidateInitData tests failed.");
    process.exit(1);
  }
  console.log("\nAll validateInitData tests passed.");
}

run();
