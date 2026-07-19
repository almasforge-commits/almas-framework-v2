import { JsonMemoryRepository } from "../../services/storage/JsonMemoryRepository.js";

export class MemoryRepository {

  constructor() {
    this.driver = new JsonMemoryRepository();
  }

  async save(memory) {
    return this.driver.save(memory);
  }

  async getAll() {
    return this.driver.getAll();
  }

}