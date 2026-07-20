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
  MENU_BUTTON_LABELS,
} from "../handlers/keyboards/mainMenu.js";
import { isValidWebAppUrl } from "../config/webapp.js";

// Pure keyboard builders — no bot/Telegram/network/filesystem access.

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
  test("buildMainMenuKeyboard() returns the exact 2x4 grid of required buttons, in order", () => {
    const { reply_markup } = buildMainMenuKeyboard();
    assert.deepEqual(flatten(reply_markup.keyboard), [
      MENU_BUTTON_LABELS.knowledge,
      MENU_BUTTON_LABELS.ideas,
      MENU_BUTTON_LABELS.tasks,
      MENU_BUTTON_LABELS.projects,
      MENU_BUTTON_LABELS.finance,
      MENU_BUTTON_LABELS.memory,
      MENU_BUTTON_LABELS.openAlmas,
      MENU_BUTTON_LABELS.help,
    ]);
    assert.deepEqual(MENU_BUTTON_LABELS, {
      knowledge: "📚 Знания",
      ideas: "💡 Идеи",
      tasks: "📋 Задачи",
      projects: "🚀 Проекты",
      finance: "💰 Финансы",
      memory: "🧠 Память",
      openAlmas: "🌐 Открыть ALMAS",
      help: "❓ Помощь",
      home: "🏠 Главная",
    });
  });

  test("buildMainMenuKeyboard() is persistent and resizable", () => {
    const { reply_markup } = buildMainMenuKeyboard();
    assert.equal(reply_markup.resize_keyboard, true);
    assert.equal(reply_markup.is_persistent, true);
  });

  test("buildMainMenuKeyboard(): with ALMAS_WEB_APP_URL unset (this repo's real, untouched .env), the Open-ALMAS button is a plain text button, not web_app", () => {
    const { reply_markup } = buildMainMenuKeyboard();
    const button = reply_markup.keyboard[3][0];
    assert.equal(button.text, MENU_BUTTON_LABELS.openAlmas);
    assert.equal(button.web_app, undefined);
  });

  test("buildHomeOnlyKeyboard() returns a single inline 'Главная' button with callback_data menu:home", () => {
    const { reply_markup } = buildHomeOnlyKeyboard();
    assert.deepEqual(reply_markup.inline_keyboard, [
      [{ text: "🏠 Главная", callback_data: "menu:home" }],
    ]);
  });

  test("buildKnowledgeMenuKeyboard() has 'Все знания', 'Поиск', and 'Главная' with the expected callback_data", () => {
    const { reply_markup } = buildKnowledgeMenuKeyboard();
    const buttons = reply_markup.inline_keyboard.flat();
    assert.deepEqual(
      buttons.map((b) => b.callback_data),
      ["menu:knowledge:all", "menu:knowledge:search", "menu:home"]
    );
  });

  test("buildTasksMenuKeyboard() has 'Выполненные' and 'Главная'", () => {
    const { reply_markup } = buildTasksMenuKeyboard();
    const buttons = reply_markup.inline_keyboard.flat();
    assert.deepEqual(buttons.map((b) => b.callback_data), ["menu:tasks:done", "menu:home"]);
  });

  test("buildFinanceMenuKeyboard() has 'История', 'Статистика', and 'Главная'", () => {
    const { reply_markup } = buildFinanceMenuKeyboard();
    const buttons = reply_markup.inline_keyboard.flat();
    assert.deepEqual(
      buttons.map((b) => b.callback_data),
      ["menu:finance:history", "menu:finance:stats", "menu:home"]
    );
  });

  test("buildMemoryMenuKeyboard() has 'Вспомнить', 'Поиск', and 'Главная'", () => {
    const { reply_markup } = buildMemoryMenuKeyboard();
    const buttons = reply_markup.inline_keyboard.flat();
    assert.deepEqual(
      buttons.map((b) => b.callback_data),
      ["menu:memory:recall", "menu:memory:search", "menu:home"]
    );
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

  // Env-driven behavior is verified end-to-end in a genuinely separate
  // process (not via cache-busted dynamic import) because
  // handlers/keyboards/mainMenu.js statically imports config/webapp.js,
  // and Node's ESM module cache is keyed by the *resolved* specifier of
  // that static import — busting the cache of the importer alone does not
  // re-evaluate its own statically-imported dependencies.
  function readWebAppButtonInChildProcess(env) {
    const script = `
      import { buildMainMenuKeyboard } from "../handlers/keyboards/mainMenu.js";
      const { reply_markup } = buildMainMenuKeyboard();
      process.stdout.write(JSON.stringify(reply_markup.keyboard[3][0]));
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
