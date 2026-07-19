export class PipelineLogger {

    constructor(name = "Pipeline") {
  
      this.name = name;
  
      this.startedAt = Date.now();
  
      this.steps = [];
  
    }
  
    start(step) {
  
      this.steps.push({
  
        step,
  
        startedAt: Date.now(),
  
      });
  
      console.log(`🟡 [${this.name}] ${step}`);
  
    }
  
    success() {
  
      const current = this.steps.at(-1);
  
      if (!current) {
        return;
      }
  
      current.finishedAt = Date.now();
  
      current.duration =
        current.finishedAt - current.startedAt;
  
      console.log(
        `🟢 ${current.step} (${current.duration} ms)`
      );
  
    }
  
    fail(error) {
  
      const current = this.steps.at(-1);
  
      console.error(
        `🔴 ${current?.step ?? "Unknown"}`
      );
  
      console.error(error);
  
    }
  
    finish() {
  
      console.log(
        `✅ ${this.name} finished in ${
          Date.now() - this.startedAt
        } ms`
      );
  
    }
  
  }