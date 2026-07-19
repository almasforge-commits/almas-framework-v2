export function normalizeKnowledge(data) {

    if (!data) return null;
  
    const normalizeList = (items, maxItems) => {
  
      const unique = [];
  
      for (const item of items ?? []) {
  
        const value = item
          .replace(/[*•]/g, "")
          .replace(/\s+/g, " ")
          .trim();
  
        if (!value) continue;
  
        if (unique.includes(value)) continue;
  
        unique.push(value);
  
        if (unique.length >= maxItems) break;
      }
  
      return unique;
    };
  
    const normalizeTags = (tags) => {
  
      const unique = [];
  
      for (let tag of tags ?? []) {
  
        tag = tag
          .toLowerCase()
          .replace(/[()]/g, "")
          .replace(/#/g, "")
          .replace(/\s+/g, " ")
          .trim();
  
        if (!tag) continue;
  
        if (tag.split(" ").length > 2) continue;
  
        if (unique.includes(tag)) continue;
  
        unique.push(tag);
  
        if (unique.length >= 5) break;
      }
  
      return unique;
    };
  
    return {
  
      summary: data.summary?.trim() ?? "",
  
      keyPoints: normalizeList(data.keyPoints, 5),
  
      tags: normalizeTags(data.tags),
  
      ideas: normalizeList(data.ideas, 3),
  
      tasks: normalizeList(data.tasks, 3),
  
    };
  
  }