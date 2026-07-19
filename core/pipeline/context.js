export function createContext(data = {}) {

    return {
  
      input: data,
  
      source: null,
  
      transcript: null,
  
      analysis: null,
  
      knowledge: null,
  
      metadata: {},
  
      createdAt: new Date().toISOString(),
  
    };
  
  }