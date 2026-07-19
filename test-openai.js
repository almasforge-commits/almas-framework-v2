import 'dotenv/config';
import { askAI } from './providers/ai/openaiProvider.js';

async function main() {
  console.log('🧪 Проверяем OpenAI...');

  const result = await askAI(
    'You are a helpful assistant.',
    'Верни JSON вида {"message":"Привет, Алмас!"}'
  );

  console.log(result);
}

main();