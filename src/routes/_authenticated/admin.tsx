import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useRealtime } from "@/hooks/useRealtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  addAdminEmail,
  deleteBook,
  getLibraryStats,
  indexNextBatch,
  listAdminEmails,
  listBooks,
  reindexBook,
  updateZakatSetting,
  uploadBook,
} from "@/lib/admin.functions";
import { SCHOOLS, TOPICS, schoolLabel } from "@/lib/fiqh-options";

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
        <div className="mx-auto max-w-4xl px-4 py-8">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-2xl font-semibold">Admin &amp; library</h1>
            <Link to="/" className="text-sm font-medium text-primary underline">
              Back to chat
            </Link>
          </div>

          <Tabs defaultValue="upload" className="mt-6">
            <TabsList>
              <TabsTrigger value="upload">Add a kithab</TabsTrigger>
              <TabsTrigger value="books">Library</TabsTrigger>
              <TabsTrigger value="settings">Zakat rates</TabsTrigger>
              <TabsTrigger value="admins">Administrators</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="mt-5">
              <UploadPanel />
            </TabsContent>
            <TabsContent value="books" className="mt-5">
              <BooksPanel />
            </TabsContent>
            <TabsContent value="settings" className="mt-5">
              <SettingsPanel />
            </TabsContent>
            <TabsContent value="admins" className="mt-5">
              <AdminsPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  );
}

function UploadPanel() {
  const upload = useServerFn(uploadBook);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [school, setSchool] = useState("shafii");
  const [topic, setTopic] = useState("general");

  return (
    <form
      className="space-y-4 rounded-2xl border border-border p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const body = new FormData(form);
        body.set("school", school);
        body.set("topic", topic);
        setBusy(true);
        try {
          const result = await upload({ data: body });
          toast.success(
            `Added the book with ${result.passages} passages. Now index it from the Library tab.`,
          );
          form.reset();
          await queryClient.invalidateQueries({ queryKey: ["admin-books"] });
        } catch (error) {
          toast.error((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        Upload a PDF, EPUB, Word or plain-text file. Arabic text is kept as it is; the passages
        become the references the answers quote from.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="book-file">File (PDF, EPUB, DOCX or TXT, up to 25 MB)</Label>
          <Input
            id="book-file"
            name="file"
            type="file"
            accept=".pdf,.epub,.txt,.md,.docx"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="book-title">Title</Label>
          <Input id="book-title" name="title" placeholder="Minhaj al-Talibin" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="book-title-ar">Title in Arabic</Label>
          <Input id="book-title-ar" name="title_arabic" dir="rtl" placeholder="منهاج الطالبين" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="book-author">Author</Label>
          <Input id="book-author" name="author" placeholder="al-Nawawi" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="book-school">School</Label>
          <select
            id="book-school"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {SCHOOLS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="book-topic">Topic</Label>
          <select
            id="book-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {TOPICS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="book-notes">Notes (optional)</Label>
        <Textarea id="book-notes" name="notes" rows={2} placeholder="Edition, volume, remarks…" />
      </div>

      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {busy ? "Reading the file…" : "Add kithab"}
      </Button>
    </form>
  );
}

function BooksPanel() {
  const fetchBooks = useServerFn(listBooks);
  const indexBatch = useServerFn(indexNextBatch);
  const reindex = useServerFn(reindexBook);
  const remove = useServerFn(deleteBook);
  const queryClient = useQueryClient();
  const [indexing, setIndexing] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-books"],
    queryFn: () => fetchBooks(),
  });

  useRealtime("admin-books", ["books"], () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-books"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
  });

  const runIndexing = async (bookId: string, total: number) => {
    setIndexing(bookId);
    setProgress({ done: 0, total });
    try {
      let stalls = 0;
      let finished = false;
      for (let guard = 0; guard < 4000; guard += 1) {
        const step = await indexBatch({ data: { bookId } });
        setProgress({ done: total - step.remaining, total });
        if (step.done) {
          finished = true;
          break;
        }
        if (step.embedded === 0) {
          stalls += 1;
          if (stalls > 6) break;
          // The AI service is busy; wait a little and pick up where we stopped.
          await new Promise((resolve) => setTimeout(resolve, 8000 * stalls));
        } else {
          stalls = 0;
        }
      }
      if (finished) {
        toast.success("Indexing finished — this book can now be quoted in answers.");
      } else {
        toast.warning(
          "The AI service is busy, so indexing paused part-way. Press “Index now” again in a minute to continue where it stopped.",
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["admin-books"] });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIndexing(null);
      setProgress(null);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the library…</p>;
  if (!data || data.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No books yet. Add your first kithab from the other tab.
      </p>
    );

  return (
    <ul className="space-y-3">
      {data.map((book) => (
        <li key={book.id} className="rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{book.title}</p>
              {book.title_arabic ? (
                <p dir="rtl" className="text-sm text-muted-foreground">
                  {book.title_arabic}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {schoolLabel(book.school)} · {book.topic} · {book.passage_count} passages ·{" "}
                <span
                  className={
                    book.status === "ready"
                      ? "text-primary"
                      : book.status === "error"
                        ? "text-destructive"
                        : ""
                  }
                >
                  {book.status}
                </span>
              </p>
              {book.status_message ? (
                <p className="mt-1 text-xs text-muted-foreground">{book.status_message}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                disabled={indexing !== null}
                onClick={() => runIndexing(book.id, book.passage_count)}
              >
                {indexing === book.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {book.status === "ready" ? "Re-check index" : "Index now"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={indexing !== null}
                onClick={async () => {
                  await reindex({ data: { bookId: book.id } });
                  await queryClient.invalidateQueries({ queryKey: ["admin-books"] });
                  toast.success("Cleared the index. Press “Index now” to rebuild it.");
                }}
              >
                Rebuild
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${book.title}`}
                disabled={indexing !== null}
                onClick={async () => {
                  if (!window.confirm(`Delete “${book.title}” and all its passages?`)) return;
                  try {
                    await remove({ data: { bookId: book.id } });
                    await queryClient.invalidateQueries({ queryKey: ["admin-books"] });
                  } catch (error) {
                    toast.error((error as Error).message);
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
          {indexing === book.id && progress ? (
            <div className="mt-3 space-y-1">
              <Progress
                value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
              />
              <p className="text-xs text-muted-foreground">
                {progress.done} of {progress.total} passages indexed — keep this page open.
              </p>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function SettingsPanel() {
  const fetchStats = useServerFn(getLibraryStats);
  const saveSetting = useServerFn(updateZakatSetting);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => fetchStats(),
  });

  useRealtime("admin-stats", ["zakat_settings", "usage_events", "books"], () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
  });

  const save = useMutation({
    mutationFn: (input: { key: string; value: number }) => saveSetting({ data: input }),
    onSuccess: async () => {
      toast.success("Saved.");
      await queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Books" value={data.books} />
        <Stat label="Passages" value={data.passages} />
        <Stat label="Indexed passages" value={data.indexed} />
      </div>

      <div className="space-y-3 rounded-2xl border border-border p-5">
        <p className="text-sm text-muted-foreground">
          These rates are used by the zakat calculations. Update them as prices change.
        </p>
        {data.settings.map((setting) => (
          <form
            key={setting.key}
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const input = new FormData(event.currentTarget).get("value");
              save.mutate({ key: setting.key, value: Number(input) });
            }}
          >
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <Label htmlFor={`set-${setting.key}`}>{setting.label ?? setting.key}</Label>
              <Input
                id={`set-${setting.key}`}
                name="value"
                type="number"
                step="any"
                defaultValue={setting.value}
              />
            </div>
            <span className="pb-2 text-xs text-muted-foreground">{setting.unit ?? ""}</span>
            <Button type="submit" variant="outline" size="sm" disabled={save.isPending}>
              Save
            </Button>
          </form>
        ))}
      </div>

      <div className="rounded-2xl border border-border p-5">
        <h2 className="text-sm font-semibold">Recent questions</h2>
        {data.usage.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing asked yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {data.usage.map((event) => (
              <li key={event.id} className="border-b border-border pb-2 last:border-0">
                <span className="mr-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {event.mode}
                  {event.school ? ` · ${event.school}` : ""}
                </span>
                {event.question ?? "—"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AdminsPanel() {
  const fetchEmails = useServerFn(listAdminEmails);
  const addEmail = useServerFn(addAdminEmail);
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ["admin-emails"], queryFn: () => fetchEmails() });

  return (
    <div className="space-y-4 rounded-2xl border border-border p-5">
      <p className="text-sm text-muted-foreground">
        Anyone who signs in with one of these email addresses gets admin access.
      </p>
      <ul className="space-y-1 text-sm">
        {(data ?? []).map((row) => (
          <li key={row.email}>{row.email}</li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const email = String(new FormData(form).get("email") ?? "");
          try {
            await addEmail({ data: { email } });
            form.reset();
            await queryClient.invalidateQueries({ queryKey: ["admin-emails"] });
            toast.success("Administrator added.");
          } catch (error) {
            toast.error((error as Error).message);
          }
        }}
      >
        <div className="min-w-[240px] flex-1 space-y-1.5">
          <Label htmlFor="admin-email">Add an administrator</Label>
          <Input id="admin-email" name="email" type="email" placeholder="you@example.com" required />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Add
        </Button>
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
