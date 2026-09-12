import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Ghost, Loader2, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AnswerMarkdown } from "@/components/AnswerMarkdown";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { createConversation, saveMessages } from "@/lib/chat.functions";
import {
  MODES,
  SCHOOLS,
  SUGGESTIONS,
  type Mode,
  type School,
} from "@/lib/fiqh-options";
import { cn } from "@/lib/utils";

export type ChatMessage = { role: "user" | "assistant"; content: string };

type Props = {
  conversationId?: string;
  initialMessages?: ChatMessage[];
  initialMode?: Mode;
  initialSchool?: School;
  temporary?: boolean;
};

export function ChatView({
  conversationId,
  initialMessages = [],
  initialMode = "fatwa",
  initialSchool = "general",
  temporary = false,
}: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const newConversation = useServerFn(createConversation);
  const persistMessages = useServerFn(saveMessages);

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [school, setSchool] = useState<School>(initialSchool);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const persists = Boolean(user) && !temporary;
  const empty = messages.length === 0;

  useEffect(() => {
    setMessages(initialMessages);
    setMode(initialMode);
    setSchool(initialSchool);
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const activeMode = useMemo(() => MODES.find((m) => m.value === mode)!, [mode]);

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const history = [...messages, { role: "user" as const, content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    requestAnimationFrame(resizeTextarea);

    const controller = new AbortController();
    abortRef.current = controller;
    let answer = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, school, messages: history }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "The assistant could not answer right now.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: answer }]);
      }

      if (!answer.trim()) throw new Error("The assistant returned an empty answer.");

      if (persists) {
        let id = conversationId;
        if (!id) {
          const created = await newConversation({
            data: { mode, school, title: question.slice(0, 80) },
          });
          id = created.id;
        }
        await persistMessages({
          data: {
            conversationId: id,
            messages: [
              { role: "user", content: question },
              { role: "assistant", content: answer },
            ],
            ...(conversationId ? {} : { title: question.slice(0, 80) }),
          },
        });
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
        if (!conversationId) {
          navigate({ to: "/c/$conversationId", params: { conversationId: id } });
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setMessages([...history, { role: "assistant", content: answer || "_Stopped._" }]);
      } else {
        toast.error((error as Error).message);
        setMessages(history);
        setInput(question);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Mode + school controls */}
      <div className="shrink-0 border-b border-border bg-background/80 px-3 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-surface p-0.5">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  mode === m.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === "fatwa" ? (
            <select
              value={school}
              onChange={(event) => setSchool(event.target.value as School)}
              aria-label="School of thought"
              className="h-8 rounded-full border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              {SCHOOLS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          ) : null}

          {temporary ? (
            <span className="ml-auto flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-[12px] text-muted-foreground">
              <Ghost className="size-3.5" /> Temporary chat — not saved
            </span>
          ) : !user ? (
            <span className="ml-auto text-[12px] text-muted-foreground">
              Not signed in — this chat won't be saved
            </span>
          ) : null}
        </div>
      </div>

      {/* Transcript */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-14 text-center">
            <BrandMark size={54} />
            <h1 className="mt-5 text-2xl font-semibold sm:text-3xl">
              What would you like to ask?
            </h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">{activeMode.blurb}</p>
            <div className="mt-8 grid w-full gap-2 sm:grid-cols-1">
              {SUGGESTIONS[mode].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-xl border border-border bg-card px-4 py-3 text-start text-sm transition-colors hover:border-primary/50 hover:bg-surface"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6">
            {messages.map((m, index) =>
              m.role === "user" ? (
                <div key={index} className="mb-6 flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-user-bubble px-4 py-2.5 text-[0.95rem] text-user-bubble-foreground">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={index} className="mb-8 flex gap-3">
                  <BrandMark size={26} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    {m.content ? (
                      <>
                        <AnswerMarkdown content={m.content} />
                        {busy && index === messages.length - 1 ? <TypingDots /> : null}
                      </>
                    ) : (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        Consulting the library
                        <TypingDots />
                      </p>
                    )}
                  </div>
                </div>
              ),
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border bg-background px-3 pb-4 pt-3">
        <form
          className="mx-auto max-w-3xl"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-primary/60">
            <textarea
              ref={textareaRef}
              value={input}
              rows={1}
              placeholder={`Ask about ${activeMode.label.toLowerCase()}…`}
              onChange={(event) => {
                setInput(event.target.value);
                resizeTextarea();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2 text-[0.95rem] outline-none placeholder:text-muted-foreground"
            />
            {busy ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                aria-label="Stop"
                onClick={() => abortRef.current?.abort()}
              >
                <Square className="size-4" />
              </Button>
            ) : (
              <Button type="submit" size="icon" aria-label="Send" disabled={!input.trim()}>
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
            Answers are drawn from the uploaded kithabs and may contain mistakes. Verify serious
            matters with a qualified mufti.
          </p>
        </form>
      </div>
    </div>
  );
}
