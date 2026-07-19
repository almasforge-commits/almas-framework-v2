import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

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

    const response = await client.responses.create(request);

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