import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BookRow = {
  id: string;
  title: string;
  title_arabic: string | null;
  author: string | null;
  school: string;
  topic: string;
  language: string;
  file_url: string | null;
  file_type: string | null;
  status: string;
  status_message: string | null;
  passage_count: number;
  notes: string | null;
  created_at: string;
};

async function assertAdmin(context: { supabase: ReturnType<typeof Object>; userId: string }) {
  const supabase = context.supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
  };
  const { data } = await supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (data !== true) throw new Error("Only an administrator can do this.");
}

export const listBooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("books")
      .select(
        "id, title, title_arabic, author, school, topic, language, file_url, file_type, status, status_message, passage_count, notes, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as BookRow[];
  });

/** Uploads a kithab: stores the file, extracts the text and creates the passages. */
export const uploadBook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FormData) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Please choose a file to upload.");
    if (file.size > 25 * 1024 * 1024)
      throw new Error("That file is larger than 25 MB. Please split the book into smaller files.");

    const title = String(data.get("title") ?? "").trim() || file.name;
    const titleArabic = String(data.get("title_arabic") ?? "").trim() || null;
    const author = String(data.get("author") ?? "").trim() || null;
    const school = String(data.get("school") ?? "general");
    const topic = String(data.get("topic") ?? "general");
    const language = String(data.get("language") ?? "ar");
    const notes = String(data.get("notes") ?? "").trim() || null;

    const bytes = await file.arrayBuffer();
    const { extractText, chunkText } = await import("@/lib/ingest.server");
    const { uploadToCloudinary, cloudinaryConfig } = await import("@/lib/cloudinary.server");

    const extracted = await extractText(bytes, file.name, file.type);
    const chunks = chunkText(extracted.text);
    if (chunks.length === 0)
      throw new Error(
        "No readable text was found in that file. Scanned PDFs need to be run through OCR first, or upload a plain-text version.",
      );

    let fileUrl: string | null = null;
    let filePublicId: string | null = null;
    let statusMessage: string | null = extracted.ocrNeeded
      ? "Very little text was found per page — this looks like a scanned PDF, so citations may be unreliable."
      : null;

    if (cloudinaryConfig()) {
      try {
        const uploaded = await uploadToCloudinary({ name: file.name, type: file.type, bytes });
        fileUrl = uploaded.secureUrl;
        filePublicId = uploaded.publicId;
      } catch (error) {
        statusMessage = `${statusMessage ?? ""} File storage failed: ${(error as Error).message}`.trim();
      }
    } else {
      statusMessage = `${statusMessage ?? ""} Cloudinary is not configured, so the original file was not archived.`.trim();
    }

    const { data: book, error: bookError } = await context.supabase
      .from("books")
      .insert({
        title,
        title_arabic: titleArabic,
        author,
        school,
        topic,
        language,
        notes,
        file_url: fileUrl,
        file_public_id: filePublicId,
        file_type: file.name.split(".").pop()?.toLowerCase() ?? null,
        status: "indexing",
        status_message: statusMessage,
        passage_count: chunks.length,
        uploaded_by: context.userId,
      })
      .select("id")
      .single();
    if (bookError) throw new Error(bookError.message);

    const bookId = (book as { id: string }).id;
    const batchSize = 200;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const rows = chunks.slice(i, i + batchSize).map((c) => ({
        book_id: bookId,
        school,
        topic,
        chapter: c.chapter,
        page_label: c.pageLabel,
        position: c.position,
        content: c.content,
      }));
      const { error } = await context.supabase.from("book_passages").insert(rows);
      if (error) throw new Error(error.message);
    }

    return { bookId, passages: chunks.length, pages: extracted.pages, ocrNeeded: extracted.ocrNeeded };
  });

/** Embeds the next batch of passages for a book. Call repeatedly until remaining is 0. */
export const indexNextBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookId: string; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const limit = Math.min(Math.max(data.limit ?? 12, 1), 24);

    const { data: pending, error } = await context.supabase
      .from("book_passages")
      .select("id, content")
      .eq("book_id", data.bookId)
      .is("embedding", null)
      .order("position", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);

    const rows = (pending ?? []) as { id: string; content: string }[];
    if (rows.length === 0) {
      await context.supabase
        .from("books")
        .update({ status: "ready", status_message: null })
        .eq("id", data.bookId);
      const { count } = await context.supabase
        .from("book_passages")
        .select("id", { count: "exact", head: true })
        .eq("book_id", data.bookId);
      return { embedded: 0, remaining: 0, done: true, total: count ?? 0 };
    }

    const { embedText } = await import("@/lib/ai.server");
    let embedded = 0;
    for (const row of rows) {
      try {
        const vector = await embedText(row.content, "document");
        if (!vector) continue;
        const { error: updateError } = await context.supabase
          .from("book_passages")
          .update({ embedding: vector as unknown as string })
          .eq("id", row.id);
        if (updateError) throw new Error(updateError.message);
        embedded += 1;
      } catch (error) {
        const message = (error as Error).message;
        const busy = /rate limit|busy|quota|429|503/i.test(message);
        await context.supabase
          .from("books")
          .update({
            status: busy ? "indexing" : "error",
            status_message: message.slice(0, 400),
          })
          .eq("id", data.bookId);
        // A busy AI service is temporary: keep what we indexed and let the
        // caller resume the remaining passages instead of failing the book.
        if (busy) break;
        throw error;
      }
    }

    const { count: remaining } = await context.supabase
      .from("book_passages")
      .select("id", { count: "exact", head: true })
      .eq("book_id", data.bookId)
      .is("embedding", null);

    if ((remaining ?? 0) === 0) {
      await context.supabase
        .from("books")
        .update({ status: "ready", status_message: null })
        .eq("id", data.bookId);
    }

    return { embedded, remaining: remaining ?? 0, done: (remaining ?? 0) === 0, total: 0 };
  });

export const reindexBook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await context.supabase
      .from("book_passages")
      .update({ embedding: null })
      .eq("book_id", data.bookId);
    await context.supabase
      .from("books")
      .update({ status: "indexing", status_message: null })
      .eq("id", data.bookId);
    return { ok: true };
  });

export const deleteBook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: book } = await context.supabase
      .from("books")
      .select("file_public_id")
      .eq("id", data.bookId)
      .maybeSingle();
    const publicId = (book as { file_public_id: string | null } | null)?.file_public_id;
    if (publicId) {
      const { deleteFromCloudinary } = await import("@/lib/cloudinary.server");
      await deleteFromCloudinary(publicId);
    }
    const { error } = await context.supabase.from("books").delete().eq("id", data.bookId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getLibraryStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const [books, passages, indexed, usage, settings] = await Promise.all([
      context.supabase.from("books").select("id", { count: "exact", head: true }),
      context.supabase.from("book_passages").select("id", { count: "exact", head: true }),
      context.supabase
        .from("book_passages")
        .select("id", { count: "exact", head: true })
        .not("embedding", "is", null),
      context.supabase
        .from("usage_events")
        .select("id, mode, school, question, created_at")
        .order("created_at", { ascending: false })
        .limit(30),
      context.supabase.from("zakat_settings").select("key, value, unit, label").order("key"),
    ]);
    return {
      books: books.count ?? 0,
      passages: passages.count ?? 0,
      indexed: indexed.count ?? 0,
      usage: (usage.data ?? []) as {
        id: string;
        mode: string;
        school: string | null;
        question: string | null;
        created_at: string;
      }[],
      settings: (settings.data ?? []) as {
        key: string;
        value: number;
        unit: string | null;
        label: string | null;
      }[],
    };
  });

export const updateZakatSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { key: string; value: number }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("zakat_settings")
      .update({ value: data.value, updated_at: new Date().toISOString() })
      .eq("key", data.key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAdminEmails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data } = await context.supabase.from("admin_emails").select("email").order("email");
    return (data ?? []) as { email: string }[];
  });

export const addAdminEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const email = data.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Please enter a valid email address.");
    const { error } = await context.supabase.from("admin_emails").insert({ email });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (profile) {
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: (profile as { id: string }).id, role: "admin" }, { onConflict: "user_id,role" });
    }
    return { ok: true };
  });
