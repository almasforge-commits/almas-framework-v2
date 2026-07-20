import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "0003_create_inbox_items.sql"),
  "utf8"
);

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
  test("creates inbox_items table", () => {
    assert.match(sql, /create table if not exists public\.inbox_items/i);
  });

  test("unique request_key", () => {
    assert.match(sql, /constraint inbox_items_request_key_unique unique \(request_key\)/i);
  });

  test("required columns present", () => {
    for (const col of [
      "id uuid",
      "request_key text",
      "source_type text",
      "actor_key text",
      "telegram_user_id bigint",
      "chat_id bigint",
      "username text",
      "first_name text",
      "last_name text",
      "original_text text",
      "normalized_text text",
      "language text",
      "information_kinds jsonb",
      "routing_decision jsonb",
      "execution_summary jsonb",
      "status text",
      "error_code text",
      "metadata jsonb",
      "created_at timestamptz",
      "updated_at timestamptz",
    ]) {
      assert.ok(sql.includes(col), `missing column definition: ${col}`);
    }
  });

  test("source_type and status check constraints", () => {
    assert.match(sql, /inbox_items_source_type_check/i);
    assert.match(sql, /inbox_items_status_check/i);
    assert.match(sql, /telegram_text/);
    assert.match(sql, /clarification_required/);
  });

  test("information_kinds JSON-array check", () => {
    assert.match(sql, /jsonb_typeof\(information_kinds\) = 'array'/);
  });

  test("required indexes", () => {
    assert.match(sql, /inbox_items_actor_created_idx/);
    assert.match(sql, /inbox_items_source_created_idx/);
    assert.match(sql, /inbox_items_status_created_idx/);
    assert.match(sql, /inbox_items_information_kinds_gin/);
    assert.match(sql, /using gin \(information_kinds\)/i);
  });

  test("RLS enabled with separate SELECT/INSERT/UPDATE/DELETE policies; no FOR ALL", () => {
    assert.match(sql, /enable row level security/i);
    assert.match(sql, /inbox_items_select_anon/);
    assert.match(sql, /inbox_items_insert_anon/);
    assert.match(sql, /inbox_items_update_anon/);
    assert.match(sql, /inbox_items_delete_anon/);
    // Reject a real policy using FOR ALL (ignore comments / prose).
    const withoutComments = sql.replace(/--.*$/gm, "");
    assert.doesNotMatch(withoutComments, /\bfor\s+all\b/i);
  });

  test("updated_at trigger present", () => {
    assert.match(sql, /set_inbox_items_updated_at/);
    assert.match(sql, /before update on public\.inbox_items/i);
  });

  if (process.exitCode) console.error("\nSome inbox-migration tests failed.");
  else console.log("\nAll inbox-migration tests passed.");
}

run();
