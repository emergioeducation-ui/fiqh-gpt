import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Makes sure the signed-in account has a profile row and its roles.
 * Grants the admin role when the email is listed in admin_emails.
 * Safe to call on every sign-in.
 */
export const ensureProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = String((context.claims as { email?: string } | null)?.email ?? "")
      .trim()
      .toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("profiles").upsert(
      {
        id: context.userId,
        email: email || null,
        display_name: email ? email.split("@")[0] : null,
      },
      { onConflict: "id" },
    );

    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: context.userId, role: "user" }, { onConflict: "user_id,role" });

    let isAdmin = false;
    if (email) {
      const { data } = await supabaseAdmin
        .from("admin_emails")
        .select("email")
        .ilike("email", email)
        .maybeSingle();
      if (data) {
        await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: context.userId, role: "admin" }, { onConflict: "user_id,role" });
        isAdmin = true;
      }
    }

    return { isAdmin };
  });
