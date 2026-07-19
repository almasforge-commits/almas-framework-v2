export class Knowledge {
    constructor(data = {}) {
        this.id = data.id ?? crypto.randomUUID();

        this.type = data.type ?? "knowledge";

        this.title = data.title ?? "";

        this.summary = data.summary ?? "";

        this.keyPoints = data.keyPoints ?? [];

        this.tags = data.tags ?? [];

        this.tasks = data.tasks ?? [];

        this.ideas = data.ideas ?? [];

        this.source = data.source ?? {};

        this.metadata = data.metadata ?? {};

        this.createdAt = data.createdAt ?? new Date().toISOString();

        this.updatedAt = data.updatedAt ?? new Date().toISOString();
    }
}