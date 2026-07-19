import { askAI } from "../../providers/ai/openaiProvider.js";
import { normalizeKnowledge } from "./knowledgePostProcessor.js";

export async function generateSummary(transcript) {

  if (!transcript) return null;

  const systemPrompt = `
You are the knowledge extraction engine of ALMAS Framework.

Analyze the transcript.

Rules:

- Summary: maximum 120 words.
- Key points: exactly 5.
- Tags: exactly 5.
- Tags must contain only one or two words.
- No duplicate tags.
- No explanations inside tags.
- Ideas: exactly 3.
- Tasks: exactly 3.

Language:
Russian.
`;

  const schema = {
    name: "knowledge_extraction",

    schema: {
      type: "object",

      additionalProperties: false,

      properties: {

        summary: {
          type: "string",
        },

        keyPoints: {
          type: "array",
          items: {
            type: "string",
          },
          minItems: 5,
          maxItems: 5,
        },

        tags: {
          type: "array",
          items: {
            type: "string",
          },
          minItems: 5,
          maxItems: 5,
        },

        ideas: {
          type: "array",
          items: {
            type: "string",
          },
          minItems: 3,
          maxItems: 3,
        },

        tasks: {
          type: "array",
          items: {
            type: "string",
          },
          minItems: 3,
          maxItems: 3,
        },

      },

      required: [
        "summary",
        "keyPoints",
        "tags",
        "ideas",
        "tasks",
      ],
    },
  };

  const result = await askAI(
    systemPrompt,
    transcript,
    schema
  );

  if (!result) {
    return null;
  }

  return normalizeKnowledge(result);
}