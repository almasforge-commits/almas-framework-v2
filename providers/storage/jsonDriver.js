import fs from "fs/promises";
import path from "path";

const KNOWLEDGE_PATH = path.resolve(
  "knowledge",
  "youtube"
);

export async function saveJson(filename, data) {
  await fs.mkdir(KNOWLEDGE_PATH, { recursive: true });

  const filePath = path.join(KNOWLEDGE_PATH, filename);

  await fs.writeFile(
    filePath,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  return filePath;
}

export async function deleteAllJson() {

  await fs.mkdir(KNOWLEDGE_PATH, { recursive: true });

  const files = await fs.readdir(KNOWLEDGE_PATH);

  let deleted = 0;

  for (const file of files) {

    if (!file.endsWith(".json")) continue;

    await fs.unlink(path.join(KNOWLEDGE_PATH, file));

    deleted++;

  }

  return deleted;

}