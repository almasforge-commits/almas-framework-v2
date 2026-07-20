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

/**
 * Sanitize OpenAI / network failures for callers and logs.
 * Never returns headers, request ids, cookies, or raw stack objects.
 *
 * @param {unknown} error
 * @returns {{ code: string, retryable: boolean }}
 */
export function classifyOpenAiError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? NaN);
  const msg = String(error?.message ?? error ?? "")
    .toLowerCase()
    .slice(0, 500);
  const codeHint = String(error?.code ?? error?.error?.code ?? "").toLowerCase();

  if (
    codeHint === "invalid_json_schema" ||
    /invalid schema|additionalproperties|response_format|json_schema/.test(msg)
  ) {
    return { code: "invalid_json_schema", retryable: false };
  }

  if (status === 401 || status === 403 || /invalid_api_key|authentication/i.test(msg)) {
    return { code: "auth_error", retryable: false };
  }

  if (status === 429 || codeHint === "rate_limit_exceeded") {
    return { code: "rate_limited", retryable: true };
  }

  if (
    status >= 500 ||
    /timeout|etimedout|econnreset|econnrefused|network|fetch failed|socket/.test(
      msg
    )
  ) {
    return { code: "provider_unavailable", retryable: true };
  }

  return { code: "provider_error", retryable: true };
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
          ...(schema.strict === true || options.strict === true
            ? { strict: true }
            : {}),
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
      } catch {
        if (options.logErrors !== false) {
          console.error("[openai] provider_error code=invalid_json retryable=false");
        }
        if (options.throwClassified === true) {
          const err = new Error("invalid_json");
          err.code = "invalid_json";
          err.retryable = false;
          throw err;
        }
        return null;
      }
    }

    return response.output_text.trim();
  } catch (error) {
    if (error?.code && typeof error.retryable === "boolean" && options.throwClassified) {
      throw error;
    }

    const classified = classifyOpenAiError(error);
    if (options.logErrors !== false) {
      console.error(
        `[openai] provider_error code=${classified.code} retryable=${classified.retryable}`
      );
    }

    if (options.throwClassified === true) {
      const err = new Error(classified.code);
      err.code = classified.code;
      err.retryable = classified.retryable;
      throw err;
    }

    return null;
  }
}
