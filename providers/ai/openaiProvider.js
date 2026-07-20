import OpenAI from "openai";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

// Lazily constructed (same pattern as embeddingService.js /
// transcriptionService.js): constructing the OpenAI SDK client throws
// immediately if OPENAI_API_KEY is missing, so importing this module
// must never do that at load time — only askAI() actually calling out
// needs a real client.
let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return client;
}

export async function askAI(
  systemPrompt,
  userPrompt,
  schema = null,
  options = {}
) {

  try {

    const request = {
      model: options.model ?? DEFAULT_MODEL,

      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    };

    if (schema) {

      request.text = {
        format: {
          type: "json_schema",
          name: schema.name,
          schema: schema.schema,
        },
      };

    } else {

      request.text = {
        format: {
          type: "text",
        },
      };

    }

    const response = await getClient().responses.create(request);

    if (!response?.output_text) {
      return null;
    }

    if (schema) {

      try {
        return JSON.parse(response.output_text);
      } catch (error) {

        console.error("JSON Parse Error:", error);
        console.error(response.output_text);

        return null;
      }

    }

    return response.output_text.trim();

  } catch (error) {

    console.error("OpenAI Error:");
    console.error(error);

    return null;
  }

}