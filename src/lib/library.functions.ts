import { createServerFn } from "@tanstack/react-start";

export type PublicBook = {
  id: string;
  title: string;
  author: string | null;
  school: string;
  topic: string;
  language: string;
  passage_count: number;
  created_at: string;
};

/** Public, read-only list of the reference kithabs the assistant cites. */
export const listPublicBooks = createServerFn({ method: "GET" }).handler(async () => {
  const { publicDb } = await import("@/lib/db.server");
  const { data, error } = await publicDb()
    .from("books")
    .select("id, title, author, school, topic, language, passage_count, created_at")
    .order("title", { ascending: true })
    .limit(500);
  if (error) return [] as PublicBook[];
  return (data ?? []) as PublicBook[];
});
