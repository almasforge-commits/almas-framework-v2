import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  AUTH_REASON,
  botTokenFingerprint,
  normalizeBotToken,
  safeEqualStrings,
  signInitDataForTests,
  validateInitData,
  validateInitDataWithReversedHmac,
} from "../api/auth/validateInitData.js";

const BOT = "123456:ABC-DEF_test_token";

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
  test("1. valid Telegram initData passes", () => {
    const raw = makeValid();
    const result = validateInitData(raw, BOT);
    assert.equal(result.ok, true);
    assert.equal(result.actor.telegramUserId, 42);
    assert.equal(result.actor.actorKey, "telegram:42");
    assert.equal(result.actor.userId, "42");
    assert.ok(Number.isFinite(result.meta.ageSeconds));
  });

  test("2. wrong BOT_TOKEN returns signature_mismatch", () => {
    const raw = makeValid();
    const result = validateInitData(raw, "999999:WRONG_TOKEN");
    assert.equal(result.ok, false);
    assert.equal(result.code, AUTH_REASON.signature_mismatch);
  });

  test("3. reversed HMAC algorithm fails regression (correct data)", () => {
    const raw = makeValid();
    assert.equal(validateInitData(raw, BOT).ok, true);
    assert.equal(validateInitDataWithReversedHmac(raw, BOT), false);
  });

  test("4. empty initData returns empty_init_data", () => {
    assert.equal(validateInitData("", BOT).code, AUTH_REASON.empty_init_data);
    assert.equal(validateInitData("   ", BOT).code, AUTH_REASON.empty_init_data);
  });

  test("5. missing hash returns missing_hash", () => {
    const result = validateInitData(
      "auth_date=1&user=%7B%22id%22%3A1%7D",
      BOT
    );
    assert.equal(result.code, AUTH_REASON.missing_hash);
  });

  test("6. malformed user returns invalid_user_json", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const raw = signInitDataForTests(
      {
        auth_date: String(nowSec),
        user: "{not-json",
      },
      BOT
    );
    const result = validateInitData(raw, BOT);
    assert.equal(result.ok, false);
    assert.equal(result.code, AUTH_REASON.invalid_user_json);
  });

  test("7. expired auth_date returns expired_auth_date", () => {
    const old = Math.floor(Date.now() / 1000) - 48 * 60 * 60;
    const raw = makeValid({}, old);
    const result = validateInitData(raw, BOT, { maxAgeSeconds: 24 * 60 * 60 });
    assert.equal(result.ok, false);
    assert.equal(result.code, AUTH_REASON.expired_auth_date);
    assert.ok(result.meta.ageSeconds > 24 * 60 * 60);
  });

  test("8. future auth_date fails safely as expired_auth_date", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const raw = makeValid({}, future);
    const result = validateInitData(raw, BOT, { clockSkewSeconds: 60 });
    assert.equal(result.ok, false);
    assert.equal(result.code, AUTH_REASON.expired_auth_date);
  });

  test("9. missing user returns missing_user", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const raw = signInitDataForTests(
      { auth_date: String(nowSec), query_id: "x" },
      BOT
    );
    const result = validateInitData(raw, BOT);
    assert.equal(result.code, AUTH_REASON.missing_user);
  });

  test("10. tampered user JSON → signature_mismatch", () => {
    const params = new URLSearchParams(makeValid());
    params.set("user", JSON.stringify({ id: 999, first_name: "Hacker" }));
    const result = validateInitData(params.toString(), BOT);
    assert.equal(result.code, AUTH_REASON.signature_mismatch);
  });

  test("11. hash compare is case-insensitive", () => {
    const raw = makeValid();
    const params = new URLSearchParams(raw);
    params.set("hash", String(params.get("hash")).toUpperCase());
    const result = validateInitData(params.toString(), BOT);
    assert.equal(result.ok, true);
  });

  test("12. normalizeBotToken strips quotes/whitespace", () => {
    assert.equal(normalizeBotToken(`  "${BOT}"  `), BOT);
    assert.equal(normalizeBotToken(`'${BOT}'`), BOT);
    assert.equal(validateInitData(makeValid(), `  ${BOT}  `).ok, true);
  });

  test("13. botTokenFingerprint is stable 8-hex and non-reversible", () => {
    const fp = botTokenFingerprint(BOT);
    assert.match(fp, /^[0-9a-f]{8}$/);
    assert.equal(fp, botTokenFingerprint(`"${BOT}"`));
    assert.notEqual(fp, BOT);
    assert.ok(!fp.includes(":"));
  });

  test("14. valid request derives canonical actor", () => {
    const result = validateInitData(makeValid(), BOT);
    assert.deepEqual(
      {
        telegramUserId: result.actor.telegramUserId,
        userId: result.actor.userId,
        actorKey: result.actor.actorKey,
      },
      { telegramUserId: 42, userId: "42", actorKey: "telegram:42" }
    );
  });

  test("15. malformed percent encoding rejected safely", () => {
    const result = validateInitData("user=%E0%A4%A&hash=abc&auth_date=1", BOT);
    assert.equal(result.ok, false);
    assert.ok(Object.values(AUTH_REASON).includes(result.code));
  });

  test("16. timing-safe comparison handles different byte lengths", () => {
    assert.equal(safeEqualStrings("abc", "abcd"), false);
    assert.equal(safeEqualStrings("abcd", "abcd"), true);
    assert.doesNotThrow(() => safeEqualStrings("", "x"));
  });

  test("17. errors never include raw initData / token / hash material", () => {
    const raw = makeValid();
    const result = validateInitData(raw + "x", BOT);
    assert.equal(result.ok, false);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("auth_date="));
    assert.ok(!serialized.includes(BOT));
    assert.ok(!serialized.includes("first_name"));
    assert.ok(!("message" in result));
    const hash = new URLSearchParams(raw).get("hash");
    assert.ok(hash);
    assert.ok(!serialized.includes(hash));
  });

  test("18. secret key uses WebAppData as HMAC key (documented)", () => {
    // Mirror the production algorithm explicitly for audit clarity.
    const nowSec = Math.floor(Date.now() / 1000);
    const fields = {
      auth_date: String(nowSec),
      user: JSON.stringify({ id: 7, first_name: "A" }),
    };
    const pairs = Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    const dataCheckString = pairs.join("\n");
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT, "utf8")
      .digest();
    const hash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString, "utf8")
      .digest("hex");
    const raw = new URLSearchParams({ ...fields, hash }).toString();
    assert.equal(validateInitData(raw, BOT).ok, true);
  });

  if (process.exitCode) {
    console.error("\nvalidateInitData tests failed.");
    process.exit(1);
  }
  console.log("\nAll validateInitData tests passed.");
}

run();
