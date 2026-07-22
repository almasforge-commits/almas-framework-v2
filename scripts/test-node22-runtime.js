/**
 * Railway Node 22 pin + Supabase runtime readiness checks.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "../api/createApp.js";
import {
  createSupabaseClientFromEnv,
  isSupabaseReady,
  logSupabaseStartupDiagnostics,
} from "../providers/storage/supabase.js";
import { resolveListenConfig } from "../api/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

await test("1. package.json declares Node 22", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.engines?.node);
  assert.match(String(pkg.engines.node), /22/);
  assert.match(String(pkg.engines.node), />=\s*22/);
  assert.match(String(pkg.engines.node), /<\s*23/);
});

await test("2. Node version files exist in Railway root", () => {
  assert.equal(read(".nvmrc").trim(), "22");
  assert.equal(read(".node-version").trim(), "22");
});

await test("3. Railway/Nixpacks config selects Node 22", () => {
  const nix = read("nixpacks.toml");
  assert.match(nix, /NIXPACKS_NODE_VERSION\s*=\s*"22"/);
  assert.match(nix, /node api\/server\.js/);
  const railway = read("railway.toml");
  assert.match(railway, /builder\s*=\s*"NIXPACKS"/);
  assert.match(railway, /startCommand\s*=\s*"node api\/server\.js"/);
});

await test("4. API start command remains node api/server.js", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.api, "node api/server.js");
  assert.equal(pkg.scripts["start:api"], "node api/server.js");
  assert.match(read("Procfile").trim(), /^web:\s*node api\/server\.js$/m);
});

await test("5. hosted PORT behavior remains correct", () => {
  const hosted = resolveListenConfig({ PORT: "3000" });
  assert.equal(hosted.port, 3000);
  assert.equal(hosted.host, "0.0.0.0");
  assert.equal(hosted.hosted, true);
});

await test("6. Supabase client creation succeeds on Node 22+ runtime", () => {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  assert.ok(major >= 22, `expected Node >=22, got ${process.versions.node}`);
  assert.equal(typeof globalThis.WebSocket, "function");

  const { client, status } = createSupabaseClientFromEnv({
    SUPABASE_URL: "https://ohnepqwrrkjfvnyememw.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_almas_test_key_123456",
  });
  assert.equal(status.clientCreated, true);
  assert.equal(status.reasonCode, "ok");
  assert.ok(client);
  assert.equal(typeof client.from, "function");

  // Direct createClient sanity (same runtime constraint as Railway failure).
  const direct = createClient(
    "https://ohnepqwrrkjfvnyememw.supabase.co",
    "sb_publishable_almas_test_key_123456",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
  assert.equal(typeof direct.from, "function");
});

await test("7. /health reports supabase:true when client ready", async () => {
  const app = createApp({
    botToken: "node22-health-token",
    supabaseReady: true,
    log: () => {},
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const body = await fetch(`http://127.0.0.1:${port}/health`).then((r) =>
      r.json()
    );
    assert.deepEqual(body, { data: { ok: true, supabase: true } });
  } finally {
    await new Promise((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});

await test("startup diagnostics include nodeVersion (no secrets)", () => {
  const lines = [];
  logSupabaseStartupDiagnostics((line) => lines.push(String(line)));
  assert.ok(lines.some((l) => l.startsWith("[supabase] nodeVersion=")));
  assert.ok(!lines.join("\n").includes("sb_publishable_"));
  // Module may or may not be ready depending on local .env; both shapes are safe.
  assert.ok(typeof isSupabaseReady() === "boolean");
});

console.log(`\nnode22-runtime tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
