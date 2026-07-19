export class PipelineStep {

    async execute(context) {

        throw new Error(`${this.constructor.name} must implement execute()`);

    }

}