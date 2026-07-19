import { getYouTubeTranscript } from "../../../services/content/transcriptService.js";

export async function loadTranscript(context) {

  const result = await getYouTubeTranscript(
    context.input.url
  );

  if (!result?.success) {
    throw new Error("TRANSCRIPT_FAILED");
  }

  context.transcript = result.transcript;

  return context;

}