import { PipelineLogger } from "../logger/pipelineLogger.js";

export class Pipeline {

  constructor(name = "Pipeline") {

    this.name = name;

    this.steps = [];

    this.logger = new PipelineLogger(name);

  }

  use(step, name = step.name || "Anonymous Step") {

    this.steps.push({

      handler: step,

      name,

    });

    return this;

  }

  async run(context) {

    let current = context;

    try {

      for (const step of this.steps) {

        this.logger.start(step.name);

        current = await step.handler(current);

        if (!current) {
          throw new Error("Pipeline interrupted.");
        }

        this.logger.success();

      }

      this.logger.finish();

      return current;

    } catch (error) {

      this.logger.fail(error);

      throw error;

    }

  }

}