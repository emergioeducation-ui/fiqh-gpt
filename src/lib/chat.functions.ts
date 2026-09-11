import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ConversationRow = {
  id: string;
  title: string;
  mode: string;
  school: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("conversations")
      .select("id, title, mode, school, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as ConversationRow[];
  });

export const getConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const [conversation, messages] = await Promise.all([
      context.supabase
        .from("conversations")
        .select("id, title, mode, school, updated_at")
        .eq("id", data.id)
        .maybeSingle(),
      context.supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", data.id)
        .order("created_at", { ascending: true }),
    ]);
    if (conversation.error) throw new Error(conversation.error.message);
    return {
      conversation: (conversation.data ?? null) as ConversationRow | null,
      messages: (messages.data ?? []) as MessageRow[],
    };
  });

export const createConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mode: string; school: string; title?: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("conversations")
      .insert({
        user_id: context.userId,
        mode: data.mode,
        school: data.school,
        title: data.title?.slice(0, 120) || "New chat",
      })
      .select("id, title, mode, school, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row as ConversationRow;
  });

export const saveMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      conversationId: string;
      messages: { role: "user" | "assistant"; content: string }[];
      title?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    if (data.messages.length > 0) {
      const { error } = await context.supabase.from("messages").insert(
        data.messages.map((m) => ({
          conversation_id: data.conversationId,
          user_id: context.userId,
          role: m.role,
          content: m.content,
        })),
      );
      if (error) throw new Error(error.message);
    }
    const patch: Record<string, string> = { updated_at: new Date().toISOString() };
    if (data.title) patch["title"] = data.title.slice(0, 120);
    await context.supabase.from("conversations").update(patch).eq("id", data.conversationId);
    return { ok: true };
  });

export const renameConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; title: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("conversations")
      .update({ title: data.title.slice(0, 120) })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("conversations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const isCurrentUserAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: data === true };
  });
