import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — FiqhGPT" },
      {
        name: "description",
        content:
          "Sign in or create a FiqhGPT account to save your fiqh conversations. Email addresses are verified.",
      },
      { property: "og:title", content: "Sign in — FiqhGPT" },
      { property: "og:description", content: "Save your fiqh conversations in FiqhGPT." },
    ],
  }),
  component: Auth,
});

function Auth() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (tab === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <BrandMark size={44} />
          <h1 className="mt-4 text-xl font-semibold">
            {tab === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Saved chats need a verified email address.
          </p>
        </div>

        {sent ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-5 text-sm leading-relaxed">
            We sent a confirmation link to <strong>{email}</strong>. Open it to verify your
            address, then come back and sign in.
          </div>
        ) : (
          <>
            <div className="mt-7 flex rounded-full bg-surface p-0.5">
              {(["signin", "signup"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={
                    "flex-1 rounded-full py-1.5 text-[13px] font-medium transition-colors " +
                    (tab === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {value === "signin" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="mt-5 space-y-3">
              <Input
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Input
                type="password"
                required
                minLength={8}
                autoComplete={tab === "signin" ? "current-password" : "new-password"}
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Please wait…" : tab === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="underline">
            Continue without an account
          </Link>{" "}
          — chats stay temporary.
        </p>
      </div>
    </div>
  );
}
