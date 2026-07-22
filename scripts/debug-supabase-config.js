/**
 * Safe Supabase env diagnostics — never prints URL or key values.
 *
 * Usage: node scripts/debug-supabase-config.js
 */

import "dotenv/config";
import {
  createSupabaseClientFromEnv,
  logSupabaseStartupDiagnostics,
} from "../providers/storage/supabase.js";

const { status } = createSupabaseClientFromEnv(process.env);

console.log("=== ALMAS Supabase config (safe) ===");
console.log(`urlPresent=${status.urlPresent ? "true" : "false"}`);
console.log(`urlValid=${status.urlValid ? "true" : "false"}`);
console.log(`urlHost=${status.urlHost || ""}`);
console.log(`keyPresent=${status.keyPresent ? "true" : "false"}`);
console.log(`keyLength=${status.keyLength || 0}`);
console.log(`keyFormat=${status.keyFormat || "unknown"}`);
console.log(`keyFingerprint=${status.keyFingerprint || ""}`);
console.log(`clientCreated=${status.clientCreated ? "true" : "false"}`);
console.log(`reason=${status.reasonCode || ""}`);
if (status.errorName) {
  console.log(`errorName=${status.errorName}`);
}
if (status.errorMessage) {
  console.log(`errorMessage=${status.errorMessage}`);
}
console.log("--- startup log shape ---");
logSupabaseStartupDiagnostics(console.log);
