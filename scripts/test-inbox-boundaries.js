import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const NEW_INBOX_FILES = [
  "services/inbox/inboxContracts.js",
  "services/inbox/inboxSanitizer.js",
  "services/inbox/informationKindClassifier.js",
  "services/inbox/inboxService.js",
  "services/inbox/inboxObservation.js",
  "services/inbox/universalExtractionContracts.js",
  "services/inbox/universalExtractionValidator.js",
  "services/inbox/universalExtractionSanitizer.js",
  "services/inbox/universalExtractor.js",
  "providers/storage/supabaseInboxDriver.js",
  "config/inbox.js",
];

const FORBIDDEN_IMPORT_PATTERNS = [
  /config\/bot\.js/,
  /financeService\.js/,
  /memoryService\.js/,
  /taskService\.js/,
  /taskUpdateService\.js/,
  /knowledgeService\.js/,
  /actionExecutor\.js/,
  /node-telegram-bot-api/,
];

// Still must not be modified by Inbox wiring (voice derives sourceType in routeText).
const FORBIDDEN_LIVE_FILES = [
  "handlers/routes/voiceRoute.js",
  "handlers/routes/youtubeRoute.js",
  "services/inbox/actionExecutor.js",
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

function run() {
  test("new Inbox foundation files do not import Telegram / domain executors / actionExecutor", () => {
    for (const rel of NEW_INBOX_FILES) {
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        assert.doesNotMatch(
          source,
          pattern,
          `${rel} must not match ${pattern}`
        );
      }
      if (!rel.endsWith("universalExtractor.js")) {
        assert.doesNotMatch(source, /openaiProvider\.js/);
        assert.doesNotMatch(source, /openaiPlannerProvider\.js/);
      }
    }
  });

  test("forbidden live routing files were not modified in this milestone", () => {
    const status = execSync("git status --porcelain", {
      cwd: root,
      encoding: "utf8",
    });

    for (const rel of FORBIDDEN_LIVE_FILES) {
      const touched = status
        .split("\n")
        .some((line) => line.slice(3).trim() === rel || line.includes(rel));
      assert.equal(touched, false, `must not modify ${rel}; git status shows a change`);
    }
  });

  test("Inbox driver/service never log full text or embeddings", () => {
    for (const rel of [
      "providers/storage/supabaseInboxDriver.js",
      "services/inbox/inboxService.js",
    ]) {
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      assert.doesNotMatch(source, /console\.log\([^)]*originalText/);
      assert.doesNotMatch(source, /console\.log\([^)]*embedding/);
      assert.doesNotMatch(source, /console\.log\([^)]*\bdata\b[^)]*\)/);
    }
  });

  if (process.exitCode) console.error("\nSome inbox-boundaries tests failed.");
  else console.log("\nAll inbox-boundaries tests passed.");
}

run();
