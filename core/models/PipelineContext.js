export class PipelineContext {

    constructor(input = {}) {

        this.input = input.input ?? null;

        this.user = input.user ?? null;

        this.chat = input.chat ?? null;

        this.youtube = null;

        this.transcript = null;

        this.summary = null;

        this.knowledge = null;

        this.memory = [];

        this.result = null;

        this.errors = [];

        this.meta = {};

    }

    addError(error) {

        this.errors.push(error);

    }

    hasErrors() {

        return this.errors.length > 0;

    }

}