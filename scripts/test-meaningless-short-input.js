import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMeaninglessShortInput } from "../core/utils/isMeaninglessShortInput.js";
import { shouldSaveMemory } from "../services/storage/memoryFilter.js";
import { detectDeterministicIntent } from "../services/inbox/deterministicIntentDetector.js";
import { decideRouting } from "../services/inbox/routingDecisionService.js";
import { parseFinanceMessage } from "../services/finance/financeParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((error) => {
      console.error(`❌ ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

function scriptedProvider() {
  const calls = [];
  return {
    calls,
    provider: {
      name: "scripted",
      run: async () => {
        calls.push(true);
        throw new Error("AI must not be called for meaningless short input");
      },
    },
  };
}

async function run() {
  await test("pure '4' is meaningless short input", () => {
    assert.equal(isMeaninglessShortInput("4"), true);
    assert.equal(isMeaninglessShortInput("  4  "), true);
    assert.equal(isMeaninglessShortInput("40000"), true);
  });

  await test("empty / whitespace-only / one-char punctuation are meaningless", () => {
    assert.equal(isMeaninglessShortInput(""), true);
    assert.equal(isMeaninglessShortInput("   "), true);
    assert.equal(isMeaninglessShortInput("."), true);
    assert.equal(isMeaninglessShortInput("!"), true);
    assert.equal(isMeaninglessShortInput("?"), true);
    assert.equal(isMeaninglessShortInput(","), true);
  });

  await test("real commands containing numbers are NOT meaningless", () => {
    assert.equal(isMeaninglessShortInput("открыть 4"), false);
    assert.equal(isMeaninglessShortInput("выполнено 4"), false);
    assert.equal(isMeaninglessShortInput("расход 40000 кофе"), false);
    assert.equal(isMeaninglessShortInput("Потратил 40000 на кофе"), false);
    assert.equal(isMeaninglessShortInput("Завтра купить арбуз"), false);
  });

  await test("pure '4' makes zero AI provider calls", async () => {
    const { provider, calls } = scriptedProvider();
    const decision = await decideRouting("4", {
      provider,
      configOverrides: { mode: "active" },
    });
    assert.equal(calls.length, 0);
    assert.equal(decision.tier, "deterministic");
    assert.equal(decision.reasonCode, "meaningless_short_input");
  });

  await test("pure '4' is not eligible for automatic Memory", () => {
    assert.equal(shouldSaveMemory("4"), false);
    assert.equal(shouldSaveMemory("."), false);
    assert.equal(shouldSaveMemory(""), false);
  });

  await test("'открыть 4' / 'выполнено 4' stay on deterministic Tier 0", () => {
    const open = detectDeterministicIntent("открыть 4");
    assert.ok(open);
    assert.equal(open.actions[0].type, "knowledge_query");
    assert.equal(open.reasonCode, "prefix_command");

    const done = detectDeterministicIntent("выполнено 4");
    assert.ok(done);
    assert.equal(done.actions[0].type, "system_command");
    assert.equal(done.reasonCode, "prefix_command");
  });

  await test("finance numbers still parse ('расход 40000 кофе')", () => {
    assert.equal(isMeaninglessShortInput("расход 40000 кофе"), false);
    const finance = parseFinanceMessage("расход 40000 кофе");
    assert.ok(finance);
    assert.equal(finance.amount, 40000);
    assert.equal(shouldSaveMemory("расход 40000 кофе"), false);
  });

  await test("empty/punctuation-only input is skipped safely at Tier 0 (no AI)", async () => {
    assert.equal(detectDeterministicIntent("")?.reasonCode, "empty_input");
    assert.equal(detectDeterministicIntent("   ")?.reasonCode, "empty_input");

    for (const input of [".", "!", "?"]) {
      const { provider, calls } = scriptedProvider();
      const decision = await decideRouting(input, {
        provider,
        configOverrides: { mode: "shadow" },
      });
      assert.equal(calls.length, 0, `AI called for ${JSON.stringify(input)}`);
      assert.equal(decision.tier, "deterministic");
      assert.equal(decision.reasonCode, "meaningless_short_input");
    }
  });

  await test("taskStatusService source never logs full rows or the word embedding as dumped data", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "services", "storage", "taskStatusService.js"),
      "utf8"
    );
    assert.doesNotMatch(source, /Updated rows:/);
    assert.doesNotMatch(source, /\.select\(\s*["']\*["']\s*\)/);
    assert.match(source, /\.select\("id"\)/);
    assert.match(source, /\[task\] action=update_status/);
    assert.match(source, /rows=\$\{data\?\.length/);
    // Log statements themselves must never mention or dump vectors/rows.
    const logLines = source.split("\n").filter((line) => /console\.(log|error)/.test(line));
    for (const line of logLines) {
      assert.doesNotMatch(line, /embedding/i);
      assert.doesNotMatch(line, /Updated rows/i);
    }
  });

  await test("memoryService source never serializes RPC rows or full content / vectors", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "services", "storage", "memoryService.js"),
      "utf8"
    );
    assert.doesNotMatch(source, /RPC data:/);
    assert.doesNotMatch(source, /console\.log\(`\$\{saveLabel\}:`/);
    // dims= length is OK; dumping the embedding array variable directly is not.
    assert.doesNotMatch(source, /console\.log\(\s*embedding\s*\)/);
    assert.doesNotMatch(source, /console\.log\([^;]*,\s*embedding\s*\)/);
    assert.match(source, /dims=\$\{embedding \? embedding\.length/);
    assert.match(source, /\[memory\] action=search matches=/);
    assert.match(source, /const matchCount = /);
  });

  await test("messageHandler short-input fast path runs before AI routing", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "handlers", "messageHandler.js"),
      "utf8"
    );
    const shortIndex = source.indexOf("if (isMeaninglessShortInput(text))");
    const aiIndex = source.indexOf("if (isAiRouterExecutionActive())");
    assert.ok(shortIndex !== -1 && shortIndex < aiIndex);
    assert.match(source, /await sendFallback\(chatId\);/);
  });

  if (process.exitCode) {
    console.error("\nSome meaningless-short-input tests failed.");
  } else {
    console.log("\nAll meaningless-short-input tests passed.");
  }
}

run();
