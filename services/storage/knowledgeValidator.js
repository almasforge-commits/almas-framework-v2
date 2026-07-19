export function validateKnowledge(knowledge) {

    if (!knowledge) {
      throw new Error("Knowledge is required.");
    }
  
    const requiredFields = [
      "id",
      "type",
      "title",
      "summary",
      "source",
      "status",
      "createdAt",
      "updatedAt",
    ];
  
    for (const field of requiredFields) {
      if (!knowledge[field]) {
        throw new Error(`Missing field: ${field}`);
      }
    }
  
    if (!Array.isArray(knowledge.keyPoints)) {
      knowledge.keyPoints = [];
    }
  
    if (!Array.isArray(knowledge.tags)) {
      knowledge.tags = [];
    }
  
    if (!Array.isArray(knowledge.ideas)) {
      knowledge.ideas = [];
    }
  
    if (!Array.isArray(knowledge.tasks)) {
      knowledge.tasks = [];
    }
  
    return knowledge;
  }