import { generateSummary } from "../../../services/analysis/summaryService.js";

export async function generateSummaryStep(context) {

  const analysis = await generateSummary(
    context.transcript
  );

  if (!analysis) {
    throw new Error("AI_ANALYSIS_FAILED");
  }

  context.analysis = analysis;

  return context;

}