import { askAI } from "../../providers/ai/openaiProvider.js";

export async function classifyInbox(text) {

  const systemPrompt = `
You are the Inbox classifier of ALMAS.

Determine the type of the incoming message.

Available types:

youtube
website
idea
note
task
unknown

Return JSON only.
`;

  const schema = {
    name: "inbox_classification",

    schema: {
      type: "object",

      additionalProperties: false,

      properties: {

        type: {
          type: "string",
          enum: [
            "youtube",
            "website",
            "idea",
            "note",
            "task",
            "unknown"
          ]
        }

      },

      required: [
        "type"
      ]
    }
  };

  return await askAI(
    systemPrompt,
    text,
    schema
  );
}