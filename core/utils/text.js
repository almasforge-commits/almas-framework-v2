export function normalizeText(text = "") {

    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  
  }
  
  export function unique(items = []) {
  
    return [...new Set(items)];
  
  }
  
  export function cleanArray(items = []) {
  
    return items
      .map(item => item.trim())
      .filter(Boolean);
  
  }