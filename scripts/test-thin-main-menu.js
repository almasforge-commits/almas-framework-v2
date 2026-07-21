/**
 * Thin-inbox main keyboard: two buttons only + persistent restoration.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  attachPersistentMainKeyboard,
  buildMainMenuKeyboard,
  MENU_BUTTON_LABELS,
} from "../handlers/keyboards/mainMenu.js";
import {
  HELP_ONBOARDING_MESSAGE,
  MAIN_MENU_GREETING,
  FALLBACK_PROMPT,
  sendMainMenu,
  sendFallback,
  sendHelp,
  sendOpenAlmas,
} from "../handlers/routes/menuRoute.js";
import { isMenuNavigationCommand } from "../core/utils/menuNavigationCommands.js";
import { buildCaptureConfirmKeyboard } from "../handlers/keyboards/captureKeyboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

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

function flatten(keyboard) {
  return keyboard.flat().map((btn) => btn.text);
}

function spy() {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
  };
  fn.calls = calls;
  return fn;
}

await test("1. main keyboard contains exactly Open ALMAS and Как пользоваться", () => {
  const { reply_markup } = buildMainMenuKeyboard();
  assert.deepEqual(flatten(reply_markup.keyboard), [
    MENU_BUTTON_LABELS.openAlmas,
    MENU_BUTTON_LABELS.help,
  ]);
  assert.equal(reply_markup.keyboard.length, 2);
  assert.equal(reply_markup.keyboard[0].length, 1);
  assert.equal(reply_markup.keyboard[1].length, 1);
});

await test("2. domain buttons are absent from persistent keyboard", () => {
  const labels = flatten(buildMainMenuKeyboard().reply_markup.keyboard);
  for (const domain of [
    MENU_BUTTON_LABELS.knowledge,
    MENU_BUTTON_LABELS.ideas,
    MENU_BUTTON_LABELS.tasks,
    MENU_BUTTON_LABELS.projects,
    MENU_BUTTON_LABELS.finance,
    MENU_BUTTON_LABELS.memory,
  ]) {
    assert.ok(!labels.includes(domain), `must not include ${domain}`);
  }
});

await test("3. /start greeting is short + simplified keyboard", async () => {
  const send = spy();
  await sendMainMenu("c1", { sendMessageFn: send });
  const [, text, extra] = send.calls[0];
  assert.equal(text, MAIN_MENU_GREETING);
  assert.match(text, /ALMAS готов/);
  assert.ok(!/Выбери раздел/i.test(text));
  assert.deepEqual(flatten(extra.reply_markup.keyboard), [
    MENU_BUTTON_LABELS.openAlmas,
    MENU_BUTTON_LABELS.help,
  ]);
});

await test("4. меню / главная use the same simplified keyboard", async () => {
  const send = spy();
  await sendMainMenu("c1", { sendMessageFn: send });
  await sendFallback("c1", { sendMessageFn: send });
  assert.deepEqual(
    flatten(send.calls[0][2].reply_markup.keyboard),
    flatten(send.calls[1][2].reply_markup.keyboard)
  );
  assert.equal(send.calls[1][1], FALLBACK_PROMPT);
  assert.ok(isMenuNavigationCommand("меню"));
  assert.ok(isMenuNavigationCommand("🏠 Главная"));
  assert.ok(isMenuNavigationCommand("/start"));
});

await test("5–6. Open ALMAS uses Web App URL or short missing fallback", async () => {
  const sendMissing = spy();
  await sendOpenAlmas("c1", { sendMessageFn: sendMissing, webAppUrl: null });
  assert.match(sendMissing.calls[0][1], /Mini App пока не подключён/);

  const sendOk = spy();
  await sendOpenAlmas("c1", {
    sendMessageFn: sendOk,
    webAppUrl: "https://app.example/almas",
  });
  assert.ok(!/Mini App пока не подключён/.test(sendOk.calls[0][1]));
  assert.ok(sendOk.calls[0][2].reply_markup.keyboard);

  const script = `
    import { buildMainMenuKeyboard } from "../handlers/keyboards/mainMenu.js";
    const { reply_markup } = buildMainMenuKeyboard();
    process.stdout.write(JSON.stringify(reply_markup.keyboard[0][0]));
  `;
  const withUrl = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: __dirname,
      env: { ...process.env, ALMAS_WEB_APP_URL: "https://app.almas.example/" },
      encoding: "utf8",
    })
  );
  assert.deepEqual(withUrl, {
    text: MENU_BUTTON_LABELS.openAlmas,
    web_app: { url: "https://app.almas.example/" },
  });
});

await test("7–8. Help is concise onboarding with finance/idea/task/memory/mixed examples", async () => {
  const send = spy();
  await sendHelp("c1", { sendMessageFn: send });
  const [, text, extra] = send.calls[0];
  assert.equal(text, HELP_ONBOARDING_MESSAGE);
  const lines = text.split("\n").filter((l) => l.trim());
  assert.ok(lines.length <= 14, `expected ≤14 lines, got ${lines.length}`);
  assert.match(text, /кофе|VND/i);
  assert.match(text, /идея/i);
  assert.match(text, /позвонить|Завтра/i);
  assert.match(text, /Запомни/i);
  assert.match(text, /одним сообщением/i);
  assert.ok(!/Universal Extraction|AI Router|Capture Session|embeddings|Supabase|shadow mode/i.test(text));
  assert.deepEqual(flatten(extra.reply_markup.keyboard), [
    MENU_BUTTON_LABELS.openAlmas,
    MENU_BUTTON_LABELS.help,
  ]);
  assert.ok(isMenuNavigationCommand("❓ Как пользоваться"));
  assert.ok(isMenuNavigationCommand("❓ Помощь"));
});

await test("9–12. typed domain menu labels remain navigation commands", () => {
  for (const label of [
    "📚 Знания",
    "💡 Идеи",
    "📋 Задачи",
    "💰 Финансы",
    "🧠 Память",
    "баланс",
  ]) {
    // Domain buttons still recognized as menu nav where listed; finance query is separate.
    if (label === "баланс") continue;
    assert.ok(isMenuNavigationCommand(label), label);
  }
  const handlerSrc = readFileSync(
    path.join(root, "handlers/messageHandler.js"),
    "utf8"
  );
  assert.match(handlerSrc, /"📚 знания"/);
  assert.match(handlerSrc, /"💡 идеи"/);
  assert.match(handlerSrc, /"🧠 память"/);
  assert.match(handlerSrc, /"📋 задачи"/);
  assert.match(handlerSrc, /sendFinanceMenu|handleFinanceQuery/);
});

await test("13. Capture Session keyboard unchanged (confirm/cancel + review)", () => {
  const { reply_markup } = buildCaptureConfirmKeyboard({ sessionId: "s1" });
  const flat = reply_markup.inline_keyboard.flat();
  assert.ok(flat.some((b) => /confirm/i.test(String(b.callback_data || ""))));
  assert.ok(flat.some((b) => /cancel/i.test(String(b.callback_data || ""))));
});

await test("14. voiceRoute source untouched by menu simplification", () => {
  const voice = readFileSync(path.join(root, "handlers/routes/voiceRoute.js"), "utf8");
  assert.match(voice, /handleVoiceMessage/);
  assert.match(voice, /transcribeFn/);
});

await test("15. attachPersistentMainKeyboard restores reply kb without touching inline", () => {
  const plain = attachPersistentMainKeyboard({});
  assert.ok(plain.reply_markup.keyboard);
  assert.deepEqual(flatten(plain.reply_markup.keyboard), [
    MENU_BUTTON_LABELS.openAlmas,
    MENU_BUTTON_LABELS.help,
  ]);

  const withInline = attachPersistentMainKeyboard({
    reply_markup: { inline_keyboard: [[{ text: "x", callback_data: "y" }]] },
  });
  assert.ok(withInline.reply_markup.inline_keyboard);
  assert.equal(withInline.reply_markup.keyboard, undefined);

  const withKb = attachPersistentMainKeyboard({
    reply_markup: { keyboard: [[{ text: "keep" }]], resize_keyboard: true },
  });
  assert.deepEqual(withKb.reply_markup.keyboard, [[{ text: "keep" }]]);
});

await test("bot sendMessage wrapper restores keyboard", () => {
  const botSrc = readFileSync(path.join(root, "config/bot.js"), "utf8");
  assert.match(botSrc, /attachPersistentMainKeyboard/);
  assert.match(botSrc, /sendMessageWithPersistentKeyboard/);
});

console.log(`\nthin-main-menu: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
