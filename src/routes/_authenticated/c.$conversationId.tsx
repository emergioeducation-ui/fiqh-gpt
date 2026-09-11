import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { ChatView, type ChatMessage } from "@/components/ChatView";
import { getConversation } from "@/lib/chat.functions";
import type { Mode, School } from "@/lib/fiqh-options";

export const Route = createFileRoute("/_authenticated/c/$conversationId")({
  loader: ({ params }) => getConversation({ data: { id: params.conversationId } }),
  head: () => ({
    meta: [
      { title: "Saved chat — FiqhGPT" },
      { name: "description", content: "Continue a saved fiqh conversation in FiqhGPT." },
      { property: "og:title", content: "Saved chat — FiqhGPT" },
      { property: "og:description", content: "Continue a saved fiqh conversation in FiqhGPT." },
    ],
  }),
  component: SavedChat,
  errorComponent: () => (
    <AppShell>
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold">This chat could not be opened</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          It may have been deleted, or it belongs to another account.
        </p>
        <Link to="/" className="text-sm font-medium text-primary underline">
          Start a new chat
        </Link>
      </div>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Chat not found.
      </div>
    </AppShell>
  ),
});

function SavedChat() {
  const { conversationId } = Route.useParams();
  const { conversation, messages } = Route.useLoaderData();

  return (
    <AppShell activeConversationId={conversationId}>
      <ChatView
        conversationId={conversationId}
        initialMessages={messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })) as ChatMessage[]}
        initialMode={(conversation?.mode as Mode) ?? "fatwa"}
        initialSchool={(conversation?.school as School) ?? "general"}
      />
    </AppShell>
  );
}
