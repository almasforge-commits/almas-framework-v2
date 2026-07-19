import { createPipeline } from "../../core/pipeline/index.js";
import { createContext } from "../../core/pipeline/context.js";

import { validateInput } from "../../core/pipeline/steps/validateInput.js";
import { loadYouTubeInfo } from "../../core/pipeline/steps/loadYouTubeInfo.js";
import { loadTranscript } from "../../core/pipeline/steps/loadTranscript.js";
import { generateSummaryStep } from "../../core/pipeline/steps/generateSummary.js";
import { buildKnowledge } from "../../core/pipeline/steps/buildKnowledge.js";

export async function runYouTubeWorkflow(url) {

  try {

    const pipeline = createPipeline("YouTube Pipeline");

    pipeline
      .use(validateInput, "Validate Input")
      .use(loadYouTubeInfo, "Load Video")
      .use(loadTranscript, "Load Transcript")
      .use(generateSummaryStep, "AI Summary")
      .use(buildKnowledge, "Build Knowledge");

    const result = await pipeline.run(
      createContext({
        url,
      })
    );

    return {

      success: true,

      knowledge: result.knowledge,

    };

  } catch (error) {

    return {

      success: false,

      error: error.message,

    };

  }

}