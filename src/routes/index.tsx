import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { ChatView } from "@/components/ChatView";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { temporary?: boolean } =>
    search["temporary"] === true || search["temporary"] === "true" ? { temporary: true } : {},
  head: () => ({
    meta: [
      { title: "FiqhGPT — Fatwa, Faraid and Zakat answered from the kithabs" },
      {
        name: "description",
        content:
          "Ask fiqh questions and get answers grounded in uploaded Arabic kithabs, with Shafi'i, Hanafi, Maliki and Hanbali positions, inheritance shares and zakat calculations.",
      },
      { property: "og:title", content: "FiqhGPT — Fatwa, Faraid and Zakat assistant" },
      {
        property: "og:description",
        content:
          "A fiqh research assistant that cites the Arabic texts it answers from, with faraid and zakat calculators.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const { temporary } = Route.useSearch();
  return (
    <AppShell>
      <ChatView temporary={temporary === true} />
    </AppShell>
  );
}
