import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const apiRoot = path.join(root, "api");

const FORBIDDEN_IMPORT_SNIPPETS = [
  "actionExecutor",
  "actionPlanner",
  "routingDecisionService",
  "inboxObservation",
  "universalExtractor",
  "taskStatusService",
  "taskUpdateService",
  "memoryService",
  "addExpense",
  "addIncome",
  "deleteLastTransaction",
  "saveMemory",
  "saveKnowledge",
  "insertInboxItem",
  "updateInboxItemByRequestKey",
  "observeInbox",
];

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

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

function run() {
  test("no API module imports write/execution services", () => {
    const files = walk(apiRoot);
    assert.ok(files.length > 0);
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const snippet of FORBIDDEN_IMPORT_SNIPPETS) {
        // Allow mentions in comments only if not in import lines.
        const lines = src.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          if (
            (trimmed.includes("import ") || trimmed.includes("from ")) &&
            trimmed.includes(snippet)
          ) {
            assert.fail(`${path.relative(root, file)} imports forbidden: ${snippet}`);
          }
        }
      }
    }
  });

  test("bot polling entrypoint remains unchanged (no API boot)", () => {
    const indexPath = path.join(root, "index.js");
    const src = fs.readFileSync(indexPath, "utf8");
    assert.ok(src.includes("registerMessageHandler"));
    assert.ok(!src.includes("createApp"));
    assert.ok(!src.includes("startServer"));
    assert.ok(!src.includes("api/server"));
    assert.ok(!src.includes("listen("));
  });

  test("package.json start remains bot-only; api is separate", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8")
    );
    assert.equal(pkg.scripts.start, "node index.js");
    assert.equal(pkg.scripts.api, "node api/server.js");
  });

  if (process.exitCode) {
    console.error("\nAPI boundary tests failed.");
    process.exit(1);
  }
  console.log("\nAll API boundary tests passed.");
}

run();
