/** Server-only retrieval over the uploaded kithabs. */
import { embedText } from "./ai.server";
import { publicDb } from "./db.server";

export type School = "general" | "shafii" | "hanafi" | "maliki" | "hanbali";
export type Mode = "fatwa" | "faraid" | "zakat";

export const SCHOOL_LABELS: Record<School, { en: string; ar: string }> = {
  general: { en: "General (all four schools)", ar: "عام" },
  shafii: { en: "Shafi'i school", ar: "المذهب الشافعي" },
  hanafi: { en: "Hanafi school", ar: "المذهب الحنفي" },
  maliki: { en: "Maliki school", ar: "المذهب المالكي" },
  hanbali: { en: "Hanbali school", ar: "المذهب الحنبلي" },
};

export const FOUR_SCHOOLS: School[] = ["shafii", "hanafi", "maliki", "hanbali"];

export type Passage = {
  id: string;
  book_id: string;
  book_title: string;
  book_author: string | null;
  school: string;
  topic: string;
  chapter: string | null;
  page_label: string | null;
  content: string;
  score: number;
};

function schoolFilter(school: School): string[] {
  return school === "general" ? [...FOUR_SCHOOLS, "general"] : [school, "general"];
}

function topicFilter(mode: Mode): string[] {
  return [mode, "general"];
}

/** Hybrid (semantic + Arabic full-text) retrieval, filtered by school and mode. */
export async function retrievePassages(
  question: string,
  mode: Mode,
  school: School,
  limit = 10,
): Promise<Passage[]> {
  const db = publicDb();
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(question, "query");
  } catch (error) {
    console.error("Embedding for retrieval failed", error);
  }

  const { data, error } = await db.rpc("match_book_passages", {
    query_embedding: (embedding ?? new Array(3072).fill(0)) as unknown as string,
    query_text: question,
    p_schools: schoolFilter(school),
    p_topics: topicFilter(mode),
    match_count: limit,
  });

  if (error) {
    console.error("Passage retrieval failed", error);
    return [];
  }
  return (data ?? []) as unknown as Passage[];
}

/** For "General" fatwas: retrieve per school so every madhhab is represented. */
export async function retrievePerSchool(
  question: string,
  mode: Mode,
  perSchool = 4,
): Promise<Record<School, Passage[]>> {
  const entries = await Promise.all(
    FOUR_SCHOOLS.map(async (s) => [s, await retrievePassages(question, mode, s, perSchool)] as const),
  );
  const result = Object.fromEntries(entries) as Record<School, Passage[]>;
  result.general = [];
  return result;
}

export function formatContext(passages: Passage[], offset = 0): string {
  if (passages.length === 0) return "";
  return passages
    .map((p, index) => {
      const header = [
        `[${index + 1 + offset}] Book: ${p.book_title}`,
        p.book_author ? `Author: ${p.book_author}` : null,
        p.chapter ? `Chapter: ${p.chapter}` : null,
        p.page_label ? `Page: ${p.page_label}` : null,
        `School tag: ${p.school}`,
      ]
        .filter(Boolean)
        .join(" | ");
      return `${header}\nPassage (original text):\n${p.content}`;
    })
    .join("\n\n");
}

/** Builds the comparative context for "General" fatwas, grouped per school. */
export function formatSchoolContext(grouped: Record<School, Passage[]>): {
  context: string;
  all: Passage[];
} {
  const all: Passage[] = [];
  const blocks: string[] = [];
  for (const school of FOUR_SCHOOLS) {
    const passages = grouped[school] ?? [];
    const label = SCHOOL_LABELS[school];
    if (passages.length === 0) {
      blocks.push(`### ${label.en} (${label.ar})\nNo passage found in the uploaded library.`);
      continue;
    }
    blocks.push(`### ${label.en} (${label.ar})\n${formatContext(passages, all.length)}`);
    all.push(...passages);
  }
  return { context: blocks.join("\n\n"), all };
}
