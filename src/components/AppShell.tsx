import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Ghost,
  LogIn,
  LogOut,
  Menu,
  MessageSquarePlus,
  Moon,
  PanelLeftClose,
  Shield,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth, useIsAdmin } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { deleteConversation, listConversations } from "@/lib/chat.functions";
import { modeLabel } from "@/lib/fiqh-options";
import { cn } from "@/lib/utils";

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const stored = window.localStorage.getItem("fiqhgpt-theme");
    const next = stored === "light" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    window.localStorage.setItem("fiqhgpt-theme", next);
  };
  return { theme, toggle };
}

function ConversationList({
  activeId,
  onNavigate,
}: {
  activeId?: string | undefined;
  onNavigate?: (() => void) | undefined;
}) {
  const fetchConversations = useServerFn(listConversations);
  const removeConversation = useServerFn(deleteConversation);
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => fetchConversations(),
  });

  if (isLoading) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">Loading your chats…</p>;
  }
  if (!data || data.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Your saved chats will appear here.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {data.map((c) => (
        <li key={c.id} className="group relative">
          <Link
            to="/c/$conversationId"
            params={{ conversationId: c.id }}
            onClick={onNavigate}
            className={cn(
              "block truncate rounded-lg px-3 py-2 pr-9 text-sm transition-colors hover:bg-sidebar-accent",
              activeId === c.id && "bg-sidebar-accent font-medium",
            )}
          >
            <span className="mr-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {modeLabel(c.mode)}
            </span>
            {c.title}
          </Link>
          <button
            type="button"
            aria-label={`Delete ${c.title}`}
            onClick={async (event) => {
              event.preventDefault();
              try {
                await removeConversation({ data: { id: c.id } });
                await queryClient.invalidateQueries({ queryKey: ["conversations"] });
                if (activeId === c.id) navigate({ to: "/" });
                else router.invalidate();
              } catch (error) {
                toast.error((error as Error).message);
              }
            }}
            className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-destructive focus:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SidebarBody({
  activeId,
  onNavigate,
}: {
  activeId?: string | undefined;
  onNavigate?: (() => void) | undefined;
}) {
  const { user } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-3 py-3.5">
        <Link to="/" onClick={onNavigate} className="block">
          <BrandLockup subtitle="Fiqh research assistant" />
        </Link>
      </div>

      <div className="space-y-1 px-2">
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-lg border border-sidebar-border px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent"
        >
          <MessageSquarePlus className="size-4" /> New chat
        </Link>
        <Link
          to="/"
          search={{ temporary: true }}
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Ghost className="size-4" /> Temporary chat
        </Link>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-2 pb-4">
        {user ? (
          <>
            <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Your chats
            </p>
            <ConversationList activeId={activeId} onNavigate={onNavigate} />
          </>
        ) : (
          <div className="rounded-xl border border-sidebar-border p-3 text-xs leading-relaxed text-muted-foreground">
            Sign in to keep your chats. Without an account every chat is temporary and disappears
            when you leave.
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-sidebar-border p-2">
        {isAdmin ? (
          <Link
            to="/admin"
            onClick={onNavigate}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
          >
            <Shield className="size-4" /> Admin & library
          </Link>
        ) : null}
        <Link
          to="/library"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
        >
          <BookOpen className="size-4" /> Reference books
        </Link>
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {theme === "dark" ? "Light appearance" : "Dark appearance"}
        </button>
        {user ? (
          <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            <button
              type="button"
              aria-label="Sign out"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/" });
              }}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <Link
            to="/auth"
            onClick={onNavigate}
            className="flex items-center gap-2 rounded-lg bg-sidebar-primary px-3 py-2 text-sm font-medium text-sidebar-primary-foreground transition-opacity hover:opacity-90"
          >
            <LogIn className="size-4" /> Sign in / create account
          </Link>
        )}
      </div>
    </div>
  );
}

export function AppShell({
  children,
  activeConversationId,
}: {
  children: ReactNode;
  activeConversationId?: string | undefined;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <aside
        className={cn(
          "hidden shrink-0 border-r border-sidebar-border transition-[width] duration-200 md:block",
          collapsed ? "w-0" : "w-[272px]",
        )}
      >
        {!collapsed ? <SidebarBody activeId={activeConversationId} /> : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[290px] p-0">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SidebarBody
                activeId={activeConversationId}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <Menu className="size-5" /> : <PanelLeftClose className="size-5" />}
          </Button>

          <div className="md:hidden">
            <BrandLockup />
          </div>
          <div className="ml-auto" />
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
