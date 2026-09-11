import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { listPublicBooks } from "@/lib/library.functions";
import { schoolLabel } from "@/lib/fiqh-options";

export const Route = createFileRoute("/library")({
  loader: () => listPublicBooks(),
  head: () => ({
    meta: [
      { title: "Reference kithabs — FiqhGPT" },
      {
        name: "description",
        content:
          "The Arabic kithabs and fiqh texts FiqhGPT cites, grouped by school of thought and topic.",
      },
      { property: "og:title", content: "Reference kithabs — FiqhGPT" },
      {
        property: "og:description",
        content: "Browse the Arabic texts FiqhGPT answers from.",
      },
    ],
  }),
  component: Library,
  errorComponent: () => (
    <AppShell>
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        The book list could not be loaded.
      </div>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Nothing here.
      </div>
    </AppShell>
  ),
});

function Library() {
  const books = Route.useLoaderData();

  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-semibold">Reference kithabs</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every answer is drawn from these texts. Ask an administrator to add a book if something
            important is missing.
          </p>

          {books.length === 0 ? (
            <p className="mt-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              No books have been added yet.
            </p>
          ) : (
            <ul className="mt-6 space-y-2">
              {books.map((book) => (
                <li
                  key={book.id}
                  className="rounded-xl border border-border bg-card px-4 py-3"
                >
                  <p className="font-arabic text-lg" dir="auto">
                    {book.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {book.author ? `${book.author} · ` : ""}
                    {schoolLabel(book.school)} · {book.topic} · {book.passage_count} passages
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
