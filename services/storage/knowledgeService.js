import crypto from "crypto";

import { saveJson } from "../../providers/storage/jsonDriver.js";
import { loadAllKnowledge } from "../../providers/storage/jsonSearchDriver.js";

import { validateKnowledge } from "./knowledgeValidator.js";
import { generateKnowledgeFingerprint } from "./knowledgeFingerprint.js";

export async function saveKnowledge(data) {

  const allKnowledge = await loadAllKnowledge();

  const fingerprint = generateKnowledgeFingerprint(data);

  const duplicate = findDuplicate(allKnowledge, fingerprint, data);

  if (duplicate) {

    const knowledge = validateKnowledge({

      ...duplicate,

      type: data.type ?? duplicate.type,
      title: data.title ?? duplicate.title,
      summary: data.summary ?? duplicate.summary,
      keyPoints: data.keyPoints ?? duplicate.keyPoints,
      tags: data.tags ?? duplicate.tags,
      ideas: data.ideas ?? duplicate.ideas,
      tasks: data.tasks ?? duplicate.tasks,

      source: {
        ...duplicate.source,
        ...(data.source ?? {}),
      },

      fingerprint,

      updatedAt: new Date().toISOString(),

    });

    await saveJson(`${knowledge.id}.json`, knowledge);

    return {
      success: true,
      created: false,
      updated: true,
      knowledge,
    };

  }

  const now = new Date().toISOString();

  const knowledge = validateKnowledge({

    id: crypto.randomUUID(),

    type: data.type,

    title: data.title,

    summary: data.summary,

    keyPoints: data.keyPoints ?? [],

    tags: data.tags ?? [],

    ideas: data.ideas ?? [],

    tasks: data.tasks ?? [],

    source: data.source,

    fingerprint,

    status: "approved",

    createdAt: now,

    updatedAt: now,

  });

  await saveJson(`${knowledge.id}.json`, knowledge);

  return {
    success: true,
    created: true,
    updated: false,
    knowledge,
  };

}

export async function getAllKnowledge() {

  const knowledge = await loadAllKnowledge();

  return knowledge.sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );

}

export async function getKnowledgeByIndex(index) {

  const knowledge = await getAllKnowledge();

  if (index < 1 || index > knowledge.length) {
    return null;
  }

  return knowledge[index - 1];

}

function findDuplicate(allKnowledge, fingerprint, data) {

  for (const item of allKnowledge) {

    if (item.fingerprint === fingerprint) {

      return item;

    }

    if (

      item.type === "youtube" &&

      data.type === "youtube" &&

      item.source?.url &&

      data.source?.url

    ) {

      const oldFingerprint = generateKnowledgeFingerprint({

        type: "youtube",

        source: {

          url: item.source.url,

        },

      });

      if (oldFingerprint === fingerprint) {

        return item;

      }

    }

  }

  return null;

}