export async function buildKnowledge(context) {

    const info = context.metadata.video;
  
    context.knowledge = {
  
      type: "youtube",
  
      title: info.title,
  
      summary: context.analysis.summary,
  
      keyPoints: context.analysis.keyPoints ?? [],
  
      tags: context.analysis.tags ?? [],
  
      ideas: context.analysis.ideas ?? [],
  
      tasks: context.analysis.tasks ?? [],
  
      rawContent: context.transcript ?? null,

      source: {
  
        url: context.input.url,
  
        author: info.channel,
  
        duration: info.duration,
  
      },
  
    };
  
    return context;
  
  }