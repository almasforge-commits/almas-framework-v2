import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Загружаем .env из корня ALMAS Framework
dotenv.config({
  path: path.resolve(__dirname, '../../../.env')
});

// Lazily constructed: createClient() throws immediately if SUPABASE_URL
// is missing/invalid, so building it at import time meant every module
// that merely imports `supabase` (transitively including, as of the AI
// router milestone, services/inbox/actionExecutor.js) would crash in
// any process without Supabase env vars — including isolated tests that
// never actually touch the database. A Proxy preserves the exact same
// `supabase.from(...)`/`supabase.rpc(...)` call sites everywhere else in
// the codebase; only the first real call constructs the client, and
// every property access is bound back to the real client so internal
// `this` usage inside the Supabase SDK keeps working.
let realClient = null;

function getRealClient() {
  if (!realClient) {
    realClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }
  return realClient;
}

export const supabase = new Proxy(
  {},
  {
    get(_target, prop, _receiver) {
      const client = getRealClient();
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);