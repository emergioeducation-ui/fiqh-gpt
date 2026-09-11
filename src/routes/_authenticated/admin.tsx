import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin & library — FiqhGPT" },
      {
        name: "description",
        content: "Upload Arabic kithabs, index them and manage zakat rates for FiqhGPT.",
      },
      { property: "og:title", content: "Admin & library — FiqhGPT" },
      {
        property: "og:description",
        content: "Upload and index the reference texts FiqhGPT answers from.",
      },
    ],
  }),
  component: Admin,
});

function Admin() {
  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-semibold">Admin & library</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Book uploading, indexing and zakat rate settings are being built here next. The
            server side is already in place.
          </p>
          <Link to="/" className="mt-6 inline-block text-sm font-medium text-primary underline">
            Back to chat
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
