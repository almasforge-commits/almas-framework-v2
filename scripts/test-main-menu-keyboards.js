import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildMainMenuKeyboard,
  buildHomeOnlyKeyboard,
  buildKnowledgeMenuKeyboard,
  buildTasksMenuKeyboard,
  buildFinanceMenuKeyboard,
  buildMemoryMenuKeyboard,
  buildIdeasMenuKeyboard,
  attachPersistentMainKeyboard,
  MENU_BUTTON_LABELS,
} from "../handlers/keyboards/mainMenu.js";
import { isValidWebAppUrl } from "../config/webapp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function flatten(keyboard) {
  return keyboard.flat().map((btn) => btn.text);
}

function run() {
  test("buildMainMenuKeyboard() is exactly Open ALMAS + Как пользоваться", () => {
    const { reply_markup } = buildMainMenuKeyboard();
    assert.deepEqual(flatten(reply_markup.keyboard), [
      MENU_BUTTON_LABELS.openAlmas,
      MENU_BUTTON_LABELS.help,
    ]);
    assert.equal(MENU_BUTTON_LABELS.help, "❓ Как пользоваться");
    assert.equal(MENU_BUTTON_LABELS.helpLegacy, "❓ Помощь");
    for (const domain of [
      MENU_BUTTON_LABELS.knowledge,
      MENU_BUTTON_LABELS.ideas,
      MENU_BUTTON_LABELS.tasks,
      MENU_BUTTON_LABELS.projects,
      MENU_BUTTON_LABELS.finance,
      MENU_BUTTON_LABELS.memory,
    ]) {
      assert.ok(!flatten(reply_markup.keyboard).includes(domain));
    }
  });

  test("buildMainMenuKeyboard() is persistent and resizable", () => {
    const { reply_markup } = buildMainMenuKeyboard();
    assert.equal(reply_markup.resize_keyboard, true);
    assert.equal(reply_markup.is_persistent, true);
  });

  test("buildMainMenuKeyboard(): with ALMAS_WEB_APP_URL unset, Open-ALMAS is plain text", () => {
    const { reply_markup } = buildMainMenuKeyboard();
    const button = reply_markup.keyboard[0][0];
    assert.equal(button.text, MENU_BUTTON_LABELS.openAlmas);
    assert.equal(button.web_app, undefined);
  });

  test("attachPersistentMainKeyboard skips inline / existing keyboard", () => {
    assert.ok(attachPersistentMainKeyboard({}).reply_markup.keyboard);
    const inline = attachPersistentMainKeyboard({
      reply_markup: { inline_keyboard: [[{ text: "a", callback_data: "b" }]] },
    });
    assert.ok(inline.reply_markup.inline_keyboard);
    assert.equal(inline.reply_markup.keyboard, undefined);
  });

  test("buildHomeOnlyKeyboard() returns a single inline 'Главная' button with callback_data menu:home", () => {
    const { reply_markup } = buildHomeOnlyKeyboard();
    const flat = reply_markup.inline_keyboard.flat();
    assert.ok(flat.some((b) => b.callback_data === "menu:home"));
  });

  test("buildKnowledgeMenuKeyboard() is Mini App open only (lists live in app)", () => {
    const { reply_markup } = buildKnowledgeMenuKeyboard();
    const buttons = reply_markup.inline_keyboard.flat();
    assert.ok(!buttons.some((b) => String(b.callback_data || "").startsWith("menu:knowledge:")));
  });

  test("buildTasksMenuKeyboard() is Mini App open only", () => {
    const { reply_markup } = buildTasksMenuKeyboard();
    const buttons = reply_markup.inline_keyboard.flat();
    assert.ok(!buttons.some((b) => b.callback_data === "menu:tasks:done"));
  });

  test("buildFinanceMenuKeyboard() is Mini App open only", () => {
    const { reply_markup } = buildFinanceMenuKeyboard();
    const buttons = reply_markup.inline_keyboard.flat();
    assert.ok(!buttons.some((b) => String(b.callback_data || "").startsWith("menu:finance:")));
  });

  test("buildMemoryMenuKeyboard() keeps chat save shortcut; lists live in Mini App", () => {
    const { reply_markup } = buildMemoryMenuKeyboard();
    const callbacks = reply_markup.inline_keyboard
      .flat()
      .map((b) => b.callback_data)
      .filter(Boolean);
    assert.deepEqual(callbacks, ["menu:memory:save"]);
  });

  test("buildIdeasMenuKeyboard() keeps chat capture shortcuts; lists live in Mini App", () => {
    const { reply_markup } = buildIdeasMenuKeyboard();
    const callbacks = reply_markup.inline_keyboard
      .flat()
      .map((b) => b.callback_data)
      .filter(Boolean);
    assert.ok(callbacks.includes("menu:ideas:new"));
    assert.ok(callbacks.includes("menu:ideas:cat:content"));
    assert.ok(!callbacks.includes("menu:ideas:search"));
    assert.ok(!callbacks.includes("menu:home"));
  });

  test("isValidWebAppUrl(): only accepts https:// URLs", () => {
    assert.equal(isValidWebAppUrl("https://example.com/app"), true);
    assert.equal(isValidWebAppUrl("http://example.com/app"), false);
    assert.equal(isValidWebAppUrl("ftp://example.com/app"), false);
    assert.equal(isValidWebAppUrl("not a url"), false);
    assert.equal(isValidWebAppUrl(""), false);
    assert.equal(isValidWebAppUrl(null), false);
    assert.equal(isValidWebAppUrl(undefined), false);
  });

  function readWebAppButtonInChildProcess(env) {
    const script = `
      import { buildMainMenuKeyboard } from "../handlers/keyboards/mainMenu.js";
      const { reply_markup } = buildMainMenuKeyboard();
      process.stdout.write(JSON.stringify(reply_markup.keyboard[0][0]));
    `;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: __dirname, env: { ...process.env, ...env }, encoding: "utf8" }
    );
    return JSON.parse(output);
  }

  test("[child process] ALMAS_WEB_APP_URL unset -> Open-ALMAS button stays a plain text button", () => {
    const button = readWebAppButtonInChildProcess({ ALMAS_WEB_APP_URL: "" });
    assert.deepEqual(button, { text: MENU_BUTTON_LABELS.openAlmas });
  });

  test("[child process] ALMAS_WEB_APP_URL set to a valid https URL -> Open-ALMAS becomes a real web_app button", () => {
    const button = readWebAppButtonInChildProcess({
      ALMAS_WEB_APP_URL: "https://app.almas.example/",
    });
    assert.deepEqual(button, {
      text: MENU_BUTTON_LABELS.openAlmas,
      web_app: { url: "https://app.almas.example/" },
    });
  });

  test("[child process] ALMAS_WEB_APP_URL set to an invalid (non-https) URL -> falls back to a plain text button", () => {
    const button = readWebAppButtonInChildProcess({
      ALMAS_WEB_APP_URL: "http://app.almas.example/",
    });
    assert.deepEqual(button, { text: MENU_BUTTON_LABELS.openAlmas });
  });

  if (process.exitCode) {
    console.error("\nSome main-menu-keyboards tests failed.");
  } else {
    console.log("\nAll main-menu-keyboards tests passed.");
  }
}

run();
