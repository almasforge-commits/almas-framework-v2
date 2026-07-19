export async function validateInput(context) {

    if (!context.input) {
      throw new Error("Input is required.");
    }
  
    return context;
  
  }