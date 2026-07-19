import { saveJson } from "../../providers/storage/jsonDriver.js";
import { loadAllKnowledge } from "../../providers/storage/jsonSearchDriver.js";

export class JsonMemoryRepository {

  async save(knowledge) {
    await saveJson(`${knowledge.id}.json`, knowledge);
    return knowledge;
  }

  async getAll() {
    return loadAllKnowledge();
  }

}