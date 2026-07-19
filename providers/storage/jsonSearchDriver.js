import fs from 'fs/promises';
import path from 'path';

const KNOWLEDGE_PATH = path.resolve('knowledge', 'youtube');

export async function loadAllKnowledge() {
  await fs.mkdir(KNOWLEDGE_PATH, { recursive: true });

  const files = await fs.readdir(KNOWLEDGE_PATH);

  const knowledge = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(KNOWLEDGE_PATH, file);

    const content = await fs.readFile(filePath, 'utf8');

    knowledge.push(JSON.parse(content));
  }

  return knowledge;
}