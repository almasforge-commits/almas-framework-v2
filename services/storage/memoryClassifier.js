export function classifyMemory(text) {
    const value = text.toLowerCase();
  
    if (
      value.startsWith("купи") ||
      value.startsWith("купить") ||
      value.startsWith("позвони") ||
      value.startsWith("позвонить") ||
      value.startsWith("сделать") ||
      value.startsWith("нужно")
    ) {
      return {
        memoryType: "task",
        importance: 8,
        status: "active",
        tags: [],
      };
    }
  
    if (
      value.includes("идея") ||
      value.includes("придумал") ||
      value.includes("создать")
    ) {
      return {
        memoryType: "idea",
        importance: 10,
        status: "active",
        tags: [],
      };
    }
  
    return {
      memoryType: "note",
      importance: 5,
      status: "active",
      tags: [],
    };
  }