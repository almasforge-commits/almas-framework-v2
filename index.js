import 'dotenv/config';
import { supabase } from './providers/storage/supabase.js';
import { registerMessageHandler } from './handlers/messageHandler.js';
import { registerCallbackHandler } from './handlers/callbackHandler.js';

const { error } = await supabase.from('memories').select('id').limit(1);

if (error) {
  console.error('❌ Ошибка подключения к Supabase:', error.message);
} else {
  console.log('✅ Supabase подключен');
}

registerMessageHandler();
registerCallbackHandler();

console.log('🤖 ALMAS Framework Bot запущен...');
import path from "path";

