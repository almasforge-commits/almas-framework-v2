export class MemoryRecord {

    constructor(data = {}) {

        this.id = data.id ?? crypto.randomUUID();

        this.type = data.type ?? "";

        this.value = data.value ?? "";

        this.confidence = data.confidence ?? 1;

        this.source = data.source ?? null;

        this.metadata = data.metadata ?? {};

        this.createdAt = data.createdAt ?? new Date().toISOString();

        this.updatedAt = data.updatedAt ?? new Date().toISOString();

    }

}