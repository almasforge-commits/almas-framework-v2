import { loadAllKnowledge } from "../../providers/storage/jsonSearchDriver.js";

const FIELD_WEIGHTS = {
  title: 10,
  tags: 8,
  keyPoints: 6,
  ideas: 5,
  tasks: 5,
  summary: 3,
};

function normalize(text = "") {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(word = "") {

  return word
    .replace(/(иями|ями|ами)$/u, "")
    .replace(/(иями|ями|ами)$/u, "")
    .replace(/(иями|ями)$/u, "")
    .replace(/(иями)$/u, "")
    .replace(/(ого|ему|ому|ыми|ими)$/u, "")
    .replace(/(иях|иях)$/u, "")
    .replace(/(иях|ах|ях)$/u, "")
    .replace(/(ами|ями)$/u, "")
    .replace(/(ией|ией|ией)$/u, "")
    .replace(/(ость|ости)$/u, "")
    .replace(/(ение|ения|ений)$/u, "")
    .replace(/(ание|ания|аний)$/u, "")
    .replace(/(иями)$/u, "")
    .replace(/(ами)$/u, "")
    .replace(/(ями)$/u, "")
    .replace(/(ов|ев|ей)$/u, "")
    .replace(/(ом|ем)$/u, "")
    .replace(/(ам|ям)$/u, "")
    .replace(/(ах|ях)$/u, "")
    .replace(/(ую|юю)$/u, "")
    .replace(/(ая|яя)$/u, "")
    .replace(/(ое|ее)$/u, "")
    .replace(/(ый|ий)$/u, "")
    .replace(/(ой)$/u, "")
    .replace(/(а|я|ы|и|у|ю|е|о)$/u, "");

}

function containsWord(text, stems) {

  const words = normalize(text)
    .split(" ")
    .filter(Boolean);

  for (const word of words) {

    const current = stem(word);

    if (stems.has(current)) {
      return true;
    }

  }

  return false;

}

export async function searchKnowledge(query) {

  if (!query?.trim()) {
    return [];
  }

  const stems = new Set(
    normalize(query)
      .split(" ")
      .filter(Boolean)
      .map(stem)
  );

  const knowledge = await loadAllKnowledge();

  return knowledge
    .map(item => {

      let score = 0;

      if (containsWord(item.title, stems)) {
        score += FIELD_WEIGHTS.title;
      }

      if (containsWord(item.summary, stems)) {
        score += FIELD_WEIGHTS.summary;
      }

      (item.tags ?? []).forEach(tag => {
        if (containsWord(tag, stems)) {
          score += FIELD_WEIGHTS.tags;
        }
      });

      (item.keyPoints ?? []).forEach(point => {
        if (containsWord(point, stems)) {
          score += FIELD_WEIGHTS.keyPoints;
        }
      });

      (item.ideas ?? []).forEach(idea => {
        if (containsWord(idea, stems)) {
          score += FIELD_WEIGHTS.ideas;
        }
      });

      (item.tasks ?? []).forEach(task => {
        if (containsWord(task, stems)) {
          score += FIELD_WEIGHTS.tasks;
        }
      });

      return {
        ...item,
        score,
      };

    })
    .filter(item => item.score > 0)
    .sort((a, b) => {

      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return new Date(b.updatedAt) - new Date(a.updatedAt);

    });

}