export async function buildKnowledge(context) {

  const source = context.metadata.source;

  context.knowledge = {

    type: source.type,

    title: source.title,

    summary: context.analysis.summary,

    keyPoints: context.analysis.keyPoints ?? [],

    tags: context.analysis.tags ?? [],

    ideas: context.analysis.ideas ?? [],

    tasks: context.analysis.tasks ?? [],

    rawContent: context.transcript ?? null,

    source: {

      url: source.url,

      author: source.author,

      duration: source.duration,

    },

  };

  return context;

}
