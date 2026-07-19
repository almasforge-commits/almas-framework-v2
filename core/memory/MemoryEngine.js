export class MemoryEngine {
    constructor(repository) {
      this.repository = repository;
    }
  
    async save(memory) {
      return this.repository.save(memory);
    }
  
    async find(query) {
      return this.repository.find(query);
    }
  
    async update(id, data) {
      return this.repository.update(id, data);
    }
  
    async remove(id) {
      return this.repository.remove(id);
    }
  }