/**
 * Authenticated Mini App buttons must use web_app, never plain url.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  buildMiniAppUrl,
  createMiniAppButton,
  isPrivateChatType,
  isWebAppLaunchButton,
  MINI_APP_PATHS,
  sanitizeMiniAppMarkupForChat,
  thinOpenReply,
  THIN_CONFIRM,
  withMiniAppOpenButton,
  capturePath,
} from "../config/deepLinks.js";
import {
  attachPersistentMainKeyboard,
  buildFinanceMenuKeyboard,
  buildIdeasMenuKeyboard,
  buildKnowledgeMenuKeyboard,
  buildMainMenuKeyboard,
  buildMemoryMenuKeyboard,
  buildTasksMenuKeyboard,
  MENU_BUTTON_LABELS,
} from "../handlers/keyboards/mainMenu.js";
import { buildCaptureConfirmKeyboard } from "../handlers/keyboards/captureKeyboard.js";
import { sendOpenAlmas } from "../handlers/routes/menuRoute.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BASE = "https://almas-framework-v2-five.vercel.app";

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

function loadMainButtonWithEnv(url) {
  const script = `
    import { buildMainMenuKeyboard } from "../handlers/keyboards/mainMenu.js";
    const { reply_markup } = buildMainMenuKeyboard();
    process.stdout.write(JSON.stringify(reply_markup.keyboard[0][0]));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: __dirname,
      env: { ...process.env, ALMAS_WEB_APP_URL: url },
      encoding: "utf8",
    })
  );
}

function loadCaptureWithEnv(sessionId, url) {
  const script = `
    import { buildCaptureConfirmKeyboard } from "../handlers/keyboards/captureKeyboard.js";
    const { reply_markup } = buildCaptureConfirmKeyboard({
      sessionId: ${JSON.stringify(sessionId)},
      baseUrl: ${JSON.stringify(url)},
    });
    process.stdout.write(JSON.stringify(reply_markup.inline_keyboard.flat()));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: __dirname,
      env: { ...process.env, ALMAS_WEB_APP_URL: url },
      encoding: "utf8",
    })
  );
}

await test("1. createMiniAppButton returns web_app, never url", () => {
  const btn = createMiniAppButton({
    text: "Open Finance →",
    path: "/finance",
    baseUrl: BASE,
  });
  assert.deepEqual(btn, {
    text: "Open Finance →",
    web_app: { url: `${BASE}/finance` },
  });
  assert.equal(btn.url, undefined);
  assert.ok(isWebAppLaunchButton(btn));
  assert.equal(
    isWebAppLaunchButton({ text: "x", url: `${BASE}/finance` }),
    false
  );
});

await test("2. main ALMAS reply-keyboard button uses web_app not url", () => {
  const button = loadMainButtonWithEnv(BASE);
  assert.equal(button.text, MENU_BUTTON_LABELS.openAlmas);
  assert.ok(button.web_app?.url);
  assert.match(button.web_app.url, /^https:\/\/almas-framework-v2-five\.vercel\.app\/?$/);
  assert.equal(button.url, undefined);
});

await test("3–7. Finance/Ideas/Memory/Tasks/Knowledge helpers use web_app", () => {
  const cases = [
    ["/finance", THIN_CONFIRM.openFinance],
    ["/ideas", THIN_CONFIRM.openIdeas],
    ["/memory", THIN_CONFIRM.openMemory],
    ["/tasks", THIN_CONFIRM.openTasks],
    ["/knowledge", THIN_CONFIRM.openKnowledge],
  ];
  for (const [pathName, label] of cases) {
    const btn = createMiniAppButton({
      text: label,
      path: pathName,
      baseUrl: BASE,
    });
    assert.ok(isWebAppLaunchButton(btn), label);
    assert.equal(btn.web_app.url, `${BASE}${pathName}`);
    assert.equal(btn.url, undefined);
  }
});

await test("8. Capture Review uses web_app with correct route", () => {
  const flat = loadCaptureWithEnv("sess-1", BASE);
  const review = flat.find((b) => b.web_app);
  assert.ok(review);
  assert.equal(review.text, THIN_CONFIRM.review);
  assert.equal(review.web_app.url, `${BASE}/capture/sess-1`);
  assert.equal(review.url, undefined);
  assert.equal(capturePath("sess-1"), "/capture/sess-1");
});

await test("9. generated URLs preserve routes (no /almas prefix)", () => {
  assert.equal(buildMiniAppUrl(MINI_APP_PATHS.finance, BASE), `${BASE}/finance`);
  assert.equal(buildMiniAppUrl(MINI_APP_PATHS.home, BASE), `${BASE}/`);
  assert.ok(!buildMiniAppUrl("/finance", BASE).includes("/almas/"));
});

await test("10. sendMessage wrapper / attachPersistentMainKeyboard keeps inline web_app", () => {
  const open = createMiniAppButton({
    text: THIN_CONFIRM.openFinance,
    path: MINI_APP_PATHS.finance,
    baseUrl: BASE,
  });
  const preserved = attachPersistentMainKeyboard({
    reply_markup: { inline_keyboard: [[open]] },
  });
  assert.deepEqual(preserved.reply_markup.inline_keyboard[0][0], open);
  assert.equal(preserved.reply_markup.keyboard, undefined);
  assert.equal(preserved.reply_markup.inline_keyboard[0][0].url, undefined);
  assert.ok(preserved.reply_markup.inline_keyboard[0][0].web_app);
});

await test("11. private chat thinOpenReply launches authenticated web_app", () => {
  const reply = thinOpenReply("💰 Updated.", MINI_APP_PATHS.finance, THIN_CONFIRM.openFinance, {
    chatType: "private",
    baseUrl: BASE,
  });
  const btn = reply.reply_markup.inline_keyboard.flat()[0];
  assert.ok(isWebAppLaunchButton(btn));
  assert.equal(btn.web_app.url, `${BASE}/finance`);
});

await test("12. unsupported chat type fails safely (no web_app / no plain url)", () => {
  assert.equal(isPrivateChatType("group"), false);
  const reply = thinOpenReply("💰 Updated.", MINI_APP_PATHS.finance, THIN_CONFIRM.openFinance, {
    chatType: "group",
    baseUrl: BASE,
  });
  assert.match(reply.text, /личном чате/i);
  assert.equal(reply.reply_markup.inline_keyboard.length, 0);

  const stripped = sanitizeMiniAppMarkupForChat(
    {
      inline_keyboard: [
        [
          createMiniAppButton({
            text: "Open",
            path: "/finance",
            baseUrl: BASE,
          }),
          { text: "cb", callback_data: "x" },
        ],
      ],
    },
    "supergroup"
  );
  assert.deepEqual(stripped.inline_keyboard, [
    [{ text: "cb", callback_data: "x" }],
  ]);
});

await test("13. sendOpenAlmas private + URL sends inline web_app button", async () => {
  const calls = [];
  await sendOpenAlmas("c1", {
    chatType: "private",
    webAppUrl: BASE,
    sendMessageFn: async (_id, text, extra) => {
      calls.push({ text, extra });
    },
  });
  assert.equal(calls.length, 1);
  const btn = calls[0].extra.reply_markup.inline_keyboard[0][0];
  assert.ok(isWebAppLaunchButton(btn));
  assert.equal(btn.url, undefined);
  assert.match(btn.web_app.url, /vercel\.app\/?$/);
});

await test("14. sendOpenAlmas group does not attach Mini App button", async () => {
  const calls = [];
  await sendOpenAlmas("c1", {
    chatType: "group",
    webAppUrl: BASE,
    sendMessageFn: async (_id, text, extra) => {
      calls.push({ text, extra });
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /личном чате/i);
  assert.equal(calls[0].extra, undefined);
});

await test("15. menu keyboards expose web_app when URL configured (child process)", () => {
  const script = `
    import {
      buildFinanceMenuKeyboard,
      buildIdeasMenuKeyboard,
      buildMemoryMenuKeyboard,
      buildTasksMenuKeyboard,
      buildKnowledgeMenuKeyboard,
    } from "../handlers/keyboards/mainMenu.js";
    const packs = [
      buildFinanceMenuKeyboard(),
      buildIdeasMenuKeyboard({ showCategories: false }),
      buildMemoryMenuKeyboard(),
      buildTasksMenuKeyboard(),
      buildKnowledgeMenuKeyboard(),
    ];
    const buttons = packs.flatMap((p) => p.reply_markup.inline_keyboard.flat())
      .filter((b) => b.web_app);
    process.stdout.write(JSON.stringify(buttons.map((b) => ({
      text: b.text,
      url: b.url ?? null,
      web_app: b.web_app,
    }))));
  `;
  const buttons = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: __dirname,
      env: { ...process.env, ALMAS_WEB_APP_URL: BASE },
      encoding: "utf8",
    })
  );
  assert.ok(buttons.length >= 5);
  for (const b of buttons) {
    assert.ok(b.web_app?.url);
    assert.equal(b.url, null);
  }
  const urls = buttons.map((b) => b.web_app.url);
  assert.ok(urls.some((u) => u.endsWith("/finance")));
  assert.ok(urls.some((u) => u.endsWith("/ideas")));
  assert.ok(urls.some((u) => u.endsWith("/memory")));
  assert.ok(urls.some((u) => u.endsWith("/tasks")));
  assert.ok(urls.some((u) => u.endsWith("/knowledge")));
});

await test("16. withMiniAppOpenButton never emits plain url", () => {
  const markup = withMiniAppOpenButton({}, "/finance", "Open Finance →", {
    baseUrl: BASE,
    chatType: "private",
  });
  const btn = markup.reply_markup.inline_keyboard[0][0];
  assert.ok(btn.web_app);
  assert.equal(Object.prototype.hasOwnProperty.call(btn, "url"), false);
});

await test("17. source audit: deepLinks/mainMenu/capture/bot avoid Mini App url buttons", () => {
  for (const rel of [
    "config/deepLinks.js",
    "handlers/keyboards/mainMenu.js",
    "handlers/keyboards/captureKeyboard.js",
    "config/bot.js",
  ]) {
    const src = readFileSync(path.join(root, rel), "utf8");
    assert.match(src, /web_app/);
    assert.ok(
      !/web_app:\s*\{\s*url\s*\}[\s\S]{0,40}\burl:\s*[`'"]https:/.test(src),
      rel
    );
  }
  // createMiniAppButton must be the shared helper
  assert.match(
    readFileSync(path.join(root, "config/deepLinks.js"), "utf8"),
    /export function createMiniAppButton/
  );
});

// Silence unused import warnings in some linters by referencing builders.
void buildMainMenuKeyboard;
void buildFinanceMenuKeyboard;
void buildIdeasMenuKeyboard;
void buildMemoryMenuKeyboard;
void buildTasksMenuKeyboard;
void buildKnowledgeMenuKeyboard;
void buildCaptureConfirmKeyboard;

console.log(`\nwebapp-buttons: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
