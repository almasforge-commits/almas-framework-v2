/**
 * Deep-link paths must match Mini App React Router (domain root, not /almas).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMiniAppUrl,
  capturePath,
  ideasPath,
  MINI_APP_PATHS,
} from "../config/deepLinks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const ORIGIN = "https://almas-framework-v2-five.vercel.app";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(err);
    failed += 1;
  }
}

const EXPECTED = {
  home: `${ORIGIN}/`,
  finance: `${ORIGIN}/finance`,
  ideas: `${ORIGIN}/ideas`,
  memory: `${ORIGIN}/memory`,
  tasks: `${ORIGIN}/tasks`,
  knowledge: `${ORIGIN}/knowledge`,
  capture: `${ORIGIN}/capture/session-abc`,
};

test("1. root deep link", () => {
  assert.equal(buildMiniAppUrl(MINI_APP_PATHS.home, ORIGIN), EXPECTED.home);
});

test("2. finance deep link", () => {
  assert.equal(buildMiniAppUrl(MINI_APP_PATHS.finance, ORIGIN), EXPECTED.finance);
});

test("3. ideas deep link", () => {
  assert.equal(buildMiniAppUrl(MINI_APP_PATHS.ideas, ORIGIN), EXPECTED.ideas);
  assert.equal(
    buildMiniAppUrl(ideasPath("id1"), ORIGIN),
    `${ORIGIN}/ideas/id1`
  );
});

test("4. memory deep link", () => {
  assert.equal(buildMiniAppUrl(MINI_APP_PATHS.memory, ORIGIN), EXPECTED.memory);
});

test("5. tasks deep link", () => {
  assert.equal(buildMiniAppUrl(MINI_APP_PATHS.tasks, ORIGIN), EXPECTED.tasks);
});

test("6. knowledge deep link", () => {
  assert.equal(
    buildMiniAppUrl(MINI_APP_PATHS.knowledge, ORIGIN),
    EXPECTED.knowledge
  );
});

test("7. capture deep link", () => {
  assert.equal(
    buildMiniAppUrl(capturePath("session-abc"), ORIGIN),
    EXPECTED.capture
  );
});

test("8. every generated path exists in React Router", () => {
  const routes = readFileSync(join(root, "mini-app/src/app/routes.tsx"), "utf8");
  for (const path of [
    'path="/"',
    'path="/finance"',
    'path="/ideas"',
    'path="/ideas/:ideaId"',
    'path="/memory"',
    'path="/tasks"',
    'path="/knowledge"',
    'path="/capture/:sessionId"',
  ]) {
    assert.ok(routes.includes(path), `missing route ${path}`);
  }
});

test("9. no /almas/... mismatch remains in deep-link helpers", () => {
  for (const value of Object.values(MINI_APP_PATHS)) {
    assert.ok(!String(value).includes("/almas"), value);
  }
  assert.ok(!ideasPath("x").includes("/almas"));
  assert.ok(!capturePath("x").includes("/almas"));
  const deep = readFileSync(join(root, "config/deepLinks.js"), "utf8");
  assert.doesNotMatch(deep, /home:\s*"\/almas"/);
  assert.doesNotMatch(deep, /finance:\s*"\/almas\/finance"/);
});

test("10. Vercel rewrite exists in Mini App root", () => {
  const vercel = JSON.parse(
    readFileSync(join(root, "mini-app/vercel.json"), "utf8")
  );
  assert.ok(Array.isArray(vercel.rewrites));
  assert.equal(vercel.rewrites[0].source, "/(.*)");
  assert.equal(vercel.rewrites[0].destination, "/index.html");
});

test("11. Vite base is root-compatible", () => {
  const vite = readFileSync(join(root, "mini-app/vite.config.ts"), "utf8");
  assert.match(vite, /base:\s*"\/"/);
});

console.log(`\ndeep-link-routes: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
