import { classifyInbox } from "./inboxClassifier.js";

export async function processInbox(text) {

  const result = await classifyInbox(text);

  if (!result) {
    return {
      success: false
    };
  }

  return {
    success: true,

    type: result.type
  };
}