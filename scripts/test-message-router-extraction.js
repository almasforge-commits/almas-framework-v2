import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// messageHandler.js unconditionally imports config/bot.js (constructs a
// real, polling TelegramBot) and, transitively, Supabase clients that throw
// without env vars. It cannot be safely imported in an isolated test in
// this task (bot import is intentionally NOT made lazy here). Instead,
// these are source-level regression tests: they read the file as text and
// assert on its structure/content, without ever executing or importing it.
// This never touches real Telegram, OpenAI, or Supabase.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, "..", "handlers", "messageHandler.js");
const source = fs.readFileSync(filePath, "utf8");
const menuRoutePath = path.join(__dirname, "..", "handlers", "routes", "menuRoute.js");
const menuRouteSource = fs.readFileSync(menuRoutePath, "utf8");

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

function extractFunctionBody(src, exportSignature, nextMarker) {
  const start = src.indexOf(exportSignature);
  assert.ok(start !== -1, `Could not find "${exportSignature}" in messageHandler.js`);
  const end = src.indexOf(nextMarker, start);
  assert.ok(end !== -1, `Could not find "${nextMarker}" after ${exportSignature}`);
  return src.slice(start, end);
}

function run() {

  test("routeText is exported with signature (chatId, text, from, options = {})", () => {
    assert.match(
      source,
      /export async function routeText\(chatId, text, from, options = \{\}\)/
    );
  });

  test("registerMessageHandler is still exported", () => {
    assert.match(source, /export function registerMessageHandler\(\)/);
  });

  const routeTextBody = extractFunctionBody(
    source,
    "export async function routeText(chatId, text, from, options = {})",
    "export function registerMessageHandler()"
  );

  test("routeText body contains no leftover msg.from references (rename was complete)", () => {
    assert.doesNotMatch(routeTextBody, /msg\.from/);
  });

  test("routeText body uses from.id / from.username / from.first_name (rename actually happened)", () => {
    assert.match(routeTextBody, /String\(from\.id\)/);
    assert.match(routeTextBody, /userId: from\.id/);
    assert.match(routeTextBody, /username: from\.username \?\? null/);
    assert.match(routeTextBody, /firstName: from\.first_name \?\? null/);
  });

  test("routeText still contains every existing typed-text branch, unchanged", () => {
    const expectedFragments = [
      '"Привет"',
      "VOICE_BLOCKED_TEXT_COMMANDS.includes(normalizedText)",
      '"спроси "',
      '"мои знания"',
      '"найди "',
      '"вспомни "',
      '"мои задачи"',
      '"выполнено "',
      '"выполненные задачи"',
      '"баланс"',
      '"история"',
      '"статистика"',
      '"сколько потратил на "',
      "isYouTubeLink(text)",
    ];

    for (const fragment of expectedFragments) {
      assert.ok(
        routeTextBody.includes(fragment),
        `Expected routeText body to still contain: ${fragment}`
      );
    }
  });

  test("routeText reads options.inputSource and options.messageId with defaults (typed text unaffected)", () => {
    assert.match(
      routeTextBody,
      /const \{ inputSource = "text", messageId = null \} = options;/
    );
  });

  test("voice safety guard blocks only when inputSource === \"voice\"", () => {
    assert.match(routeTextBody, /if \(inputSource === "voice"\) \{/);
  });

  test("voice safety guard blocks the exact destructive commands requested", () => {
    assert.match(
      source,
      /const VOICE_BLOCKED_TEXT_COMMANDS = \["удалить все знания"\];/
    );
    assert.match(
      source,
      /const VOICE_BLOCKED_FINANCE_INTENTS = \["delete_last"\];/
    );
  });

  test("voice safety guard sends the exact required warning message", () => {
    assert.match(
      source,
      /⚠️ Опасные команды голосом пока не выполняются\. Отправьте команду текстом\./
    );
  });

  test("voice safety guard checks both the text-command list and the finance-intent list before blocking", () => {
    assert.match(
      routeTextBody,
      /isDestructiveTextCommand \|\| isDestructiveFinanceIntent/
    );
  });

  test("voice safety guard is not a blanket block: it only returns early for the two listed cases", () => {
    // The guard's `if` block must return, but everything below it (finance
    // parsing, memory save, all commands) must remain reachable when the
    // guard's condition is false — i.e. for any non-destructive input.
    const guardBlock = routeTextBody.match(
      /if \(inputSource === "voice"\) \{[\s\S]*?\n  \}/
    );
    assert.ok(guardBlock, "Could not isolate the voice safety guard block");
    assert.match(guardBlock[0], /return;/);

    // Normal finance/command handling must still appear directly after the
    // guard block, not be skipped or duplicated.
    const afterGuard = routeTextBody.slice(
      routeTextBody.indexOf(guardBlock[0]) + guardBlock[0].length
    );
    assert.match(afterGuard, /if \(financeQuery\?\.intent\) \{/);
  });

  test("the voice branch passes handleVoiceMessage's recognized text into routeText with inputSource: \"voice\" and the Telegram message_id", () => {
    assert.match(
      source,
      /const recognizedText = await handleVoiceMessage\(chatId, msg\.voice\);/
    );
    assert.match(source, /if \(!recognizedText\) return;/);
    assert.match(
      source,
      /return routeText\(chatId, recognizedText, msg\.from, \{\s*inputSource: "voice",\s*messageId: msg\.message_id,\s*\}\);/
    );
  });

  test("the typed-text branch calls routeText with only messageId in options (defaults to inputSource: \"text\")", () => {
    assert.match(
      source,
      /return routeText\(chatId, text, msg\.from, \{ messageId: msg\.message_id \}\);/
    );
  });

  test("the old long fallback message was replaced with the short menu prompt + sendFallback(chatId)", () => {
    assert.doesNotMatch(source, /Пока я умею:/);
    assert.match(routeTextBody, /await sendFallback\(chatId\);/);
  });

  test("the detailed help text moved to menuRoute.js's sendHelp, byte-for-byte, reachable only via \"❓ Помощь\"", () => {
    const helpText = `Пока я умею:

👋 Привет

💸 Финансы
• расход 100 кофе
• доход 5000 зарплата
• баланс
• история
• статистика
• расходы за сегодня
• расходы за неделю
• расходы за месяц

📚 Знания
• мои знания
• открыть 1
• спроси ...
• найди ...

🧠 Память
• вспомни ...

📋 Задачи
• мои задачи
• выполнено 1
• выполненные задачи

🎥 Анализ YouTube

🗑 Удалить все знания`;

    assert.ok(
      menuRouteSource.includes(helpText),
      "Detailed help text is missing (or changed) in menuRoute.js's sendHelp"
    );
  });

  test("routeText dispatches the navigation menu BEFORE any AI routing call (and before Finance/Memory/Task/Knowledge)", () => {
    const expectedMenuKeys = [
      '"меню": () => sendMainMenu(chatId)',
      '"/start": () => sendMainMenu(chatId)',
      '"🏠 главная": () => sendMainMenu(chatId)',
      '"📚 знания": () => sendKnowledgeMenu(chatId)',
      '"💡 идеи": () => sendIdeasPlaceholder(chatId)',
      '"📋 задачи": () => sendTasksMenu(chatId)',
      '"🚀 проекты": () => sendProjectsPlaceholder(chatId)',
      '"💰 финансы": () => sendFinanceMenu(chatId, String(from.id))',
      '"🧠 память": () => sendMemoryMenu(chatId)',
      '"🌐 открыть almas": () => sendOpenAlmas(chatId)',
      '"❓ помощь": () => sendHelp(chatId)',
    ];

    for (const fragment of expectedMenuKeys) {
      assert.ok(routeTextBody.includes(fragment), `Expected menu dispatch to include: ${fragment}`);
    }

    const menuIndex = routeTextBody.indexOf("const menuHandler = {");
    const aiActiveIndex = routeTextBody.indexOf("if (isAiRouterExecutionActive()) {");
    const observeIndex = routeTextBody.indexOf("observeMessage(text, routingContext)");
    const financeQueryIndex = routeTextBody.indexOf("const financeQuery = parseFinanceQuery(text);");

    assert.ok(menuIndex !== -1, "Expected a menuHandler dispatch table in routeText");
    assert.ok(menuIndex < aiActiveIndex, "Menu dispatch must run before the active-mode AI await");
    assert.ok(menuIndex < observeIndex, "Menu dispatch must run before the shadow observeMessage() call");
    assert.ok(menuIndex < financeQueryIndex, "Menu dispatch must run before Finance/Memory/Task/Knowledge command handling");
  });

  test("messageHandler.js imports every menu route function it dispatches to from ./routes/menuRoute.js", () => {
    assert.match(
      source,
      /import \{\s*sendMainMenu,\s*sendFallback,\s*sendKnowledgeMenu,\s*sendTasksMenu,\s*sendFinanceMenu,\s*sendMemoryMenu,\s*sendIdeasPlaceholder,\s*sendProjectsPlaceholder,\s*sendOpenAlmas,\s*sendHelp,\s*\} from "\.\/routes\/menuRoute\.js";/
    );
  });

  test("routeText computes isUnparsedFinanceAttempt from looksLikeFinanceAttempt + failed parse", () => {
    assert.match(
      routeTextBody,
      /const isUnparsedFinanceAttempt =\s*\n\s*!finance && finances\.length === 0 && looksLikeFinanceAttempt\(text\);/
    );
  });

  test("Memory saving is positioned after the YouTube check (i.e. after every recognized command), not before it", () => {
    const youtubeCheckIndex = routeTextBody.indexOf("isYouTubeLink(text)");
    const memorySaveIndex = routeTextBody.indexOf("shouldSaveMemory(text)");

    assert.ok(youtubeCheckIndex !== -1, "Could not find the YouTube check");
    assert.ok(memorySaveIndex !== -1, "Could not find the Memory save check");
    assert.ok(
      memorySaveIndex > youtubeCheckIndex,
      "Memory save must run after every recognized command check, including YouTube"
    );
  });

  test("Memory saving is gated by !isUnparsedFinanceAttempt (finance-like failed parses are never saved)", () => {
    assert.match(
      routeTextBody,
      /if \(!aiOwnership\.executedActions\.length && !isUnparsedFinanceAttempt && shouldSaveMemory\(text\)\) \{/
    );
  });

  test("the destructive command handler and the voice guard use the exact same source list (VOICE_BLOCKED_TEXT_COMMANDS)", () => {
    const occurrences = routeTextBody.match(
      /VOICE_BLOCKED_TEXT_COMMANDS\.includes\(\s*normalizedText\s*\)/g
    );
    assert.ok(occurrences, "Expected VOICE_BLOCKED_TEXT_COMMANDS.includes(normalizedText) to appear");
    assert.equal(occurrences.length, 2, "Expected exactly 2 uses: the voice guard and the typed command handler");
  });

  test("messageHandler.js imports observeMessage, decideRouting, and getExecutedOwnedActions from the AI router orchestrator", () => {
    assert.match(
      source,
      /import \{\s*observeMessage,\s*decideRouting,\s*getExecutedOwnedActions,\s*\} from "\.\.\/services\/inbox\/routingDecisionService\.js";/
    );
  });

  test("messageHandler.js imports isAiRouterExecutionActive, buildRequestKey, and sendAiExecutionConfirmations", () => {
    assert.match(
      source,
      /import \{ isAiRouterExecutionActive \} from "\.\.\/config\/aiRouter\.js";/
    );
    assert.match(
      source,
      /import \{ buildRequestKey \} from "\.\.\/core\/utils\/buildRequestKey\.js";/
    );
    assert.match(
      source,
      /import \{ sendAiExecutionConfirmations \} from "\.\/routes\/aiExecutionRoute\.js";/
    );
  });

  test("routeText builds a per-message requestKey and forwards it (with chatId/from) to the AI router", () => {
    assert.match(
      routeTextBody,
      /const requestKey = buildRequestKey\(\{ chatId, messageId, text \}\);/
    );
    assert.match(
      routeTextBody,
      /const routingContext = \{ inputSource, chatId, from, requestKey \};/
    );
  });

  test("active mode (isAiRouterExecutionActive()) AWAITS decideRouting() before any legacy side effect; shadow/off keeps the original fire-and-forget observeMessage() call", () => {
    assert.match(routeTextBody, /if \(isAiRouterExecutionActive\(\)\) \{/);
    assert.match(
      routeTextBody,
      /const decision = await decideRouting\(text, routingContext\);/
    );
    assert.match(
      routeTextBody,
      /aiOwnership = getExecutedOwnedActions\(decision\);/
    );

    const hookLine = routeTextBody
      .split("\n")
      .find((line) => line.includes("observeMessage(text, routingContext)"));
    assert.ok(hookLine, "Could not find the observeMessage(...) shadow-mode call line");
    assert.doesNotMatch(hookLine, /await observeMessage/, "observeMessage(...) must never be awaited — it must not delay any reply");
    assert.match(hookLine, /\.catch\(/, "observeMessage(...) call must be guarded with .catch() as a defensive no-throw guarantee");

    // Both AI branches run after the menu fast path, and before the voice
    // destructive-command guard / Finance / Memory side effects.
    const menuIndex = routeTextBody.indexOf("const menuHandler = {");
    const activeBranchIndex = routeTextBody.indexOf("if (isAiRouterExecutionActive()) {");
    const firstGuardIndex = routeTextBody.indexOf('if (inputSource === "voice")');
    assert.ok(menuIndex !== -1 && menuIndex < activeBranchIndex, "Menu fast path must precede AI routing");
    assert.ok(activeBranchIndex !== -1 && activeBranchIndex < firstGuardIndex);
  });

  test("a decideRouting() failure in active mode is caught, leaving aiOwnership empty (legacy behavior runs normally)", () => {
    assert.match(routeTextBody, /let aiOwnership = \{ executedActions: \[\] \};/);
    const activeBlock = routeTextBody.match(
      /if \(isAiRouterExecutionActive\(\)\) \{[\s\S]*?\} else \{/
    );
    assert.ok(activeBlock, "Could not isolate the active-mode branch");
    assert.match(activeBlock[0], /try \{[\s\S]*?\} catch \(error\) \{/);
  });

  test("AI-owned execution confirmations are sent right after financeQuery is computed, before the voice guard and before Finance/Memory execution", () => {
    const confirmIndex = routeTextBody.indexOf("if (aiOwnership.executedActions.length > 0) {");
    const financeQueryIndex = routeTextBody.indexOf("const financeQuery = parseFinanceQuery(text);");
    const voiceGuardIndex = routeTextBody.indexOf('if (inputSource === "voice")');
    const financeParseIndex = routeTextBody.indexOf("const finance = parseFinanceMessage(text);");

    assert.ok(confirmIndex > financeQueryIndex, "Confirmation block must run after financeQuery is computed");
    assert.ok(confirmIndex < voiceGuardIndex, "Confirmation block must run before the voice safety guard");
    assert.ok(confirmIndex < financeParseIndex, "Confirmation block must run before deterministic Finance parsing");

    assert.match(
      routeTextBody,
      /await sendAiExecutionConfirmations\(chatId, aiOwnership\.executedActions\);/
    );
    assert.match(
      routeTextBody,
      /const mayStillHaveFinanceWork =\s*\n\s*Boolean\(financeQuery\?\.intent\) \|\| looksLikeFinanceAttempt\(text\);/
    );
  });

  test("routeText never shows the default fallback after a successful AI action (explicit early return)", () => {
    // Final ownership guard must sit immediately before the terminal
    // sendFallback (there may be an earlier sendFallback for meaningless
    // short input — use the last occurrence).
    const lastGuardIndex = routeTextBody.lastIndexOf("if (aiOwnership.executedActions.length > 0) {");
    const fallbackIndex = routeTextBody.lastIndexOf("await sendFallback(chatId);");
    assert.ok(lastGuardIndex !== -1 && lastGuardIndex < fallbackIndex);

    const guardBlock = routeTextBody.slice(lastGuardIndex, fallbackIndex);
    assert.match(guardBlock, /return;/);
  });

  test("meaningless short input is handled before AI routing and sends the menu fallback", () => {
    const shortIndex = routeTextBody.indexOf("if (isMeaninglessShortInput(text))");
    const aiIndex = routeTextBody.indexOf("if (isAiRouterExecutionActive())");
    assert.ok(shortIndex !== -1 && shortIndex < aiIndex);
    assert.match(source, /import \{ isMeaninglessShortInput \} from "\.\.\/core\/utils\/isMeaninglessShortInput\.js";/);
  });

  test("the finance success message templates are byte-identical to the pre-extraction originals", () => {
    assert.ok(
      source.includes(
        '`💸 Расход сохранён\n    \n    Сумма: ${finance.amount.toLocaleString()} ${finance.currency}\n    Описание: ${finance.description || "Без описания"}`'
      )
    );
    assert.ok(
      source.includes(
        '`💰 Доход сохранён\n    \n    Сумма: ${finance.amount.toLocaleString()} ${finance.currency}\n    Описание: ${finance.description || "Без описания"}`'
      )
    );
  });

  if (process.exitCode) {
    console.error("\nSome message-router-extraction tests failed.");
  } else {
    console.log("\nAll message-router-extraction tests passed.");
  }

}

run();
