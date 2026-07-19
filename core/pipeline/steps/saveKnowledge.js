import { memory } from "../../memory/index.js";

export async function saveKnowledgeStep(context) {
  if (!context.knowledge) {
    throw new Error("Knowledge is missing.");
  }

  context.saved = await memory.save(context.knowledge);

  return context;
}