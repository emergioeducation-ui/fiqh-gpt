/**
 * Server-only AI layer.
 *
 * Primary provider: the user's own Google Gemini API key (GEMINI_API_KEY).
 * Fallback provider: the built-in Lovable AI Gateway (LOVABLE_API_KEY), so the
 * app still answers before a Gemini key is configured.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GATEWAY_BASE = "https://ai.gateway.lovable.dev/v1";

export const GEMINI_CHAT_MODEL = process.env["GEMINI_CHAT_MODEL"] ?? "gemini-3.8-flash";
export const GEMINI_EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIMENSIONS = 3072;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function aiProvider(): "gemini" | "gateway" | "none" {
  if (process.env["GEMINI_API_KEY"]) return "gemini";
  if (process.env["LOVABLE_API_KEY"]) return "gateway";
  return "none";
}

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

/** Reads an SSE body and yields the decoded `data:` payloads. */
async function* sseEvents(response: Response): AsyncGenerator<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          yield JSON.parse(payload);
        } catch {
          /* ignore malformed keep-alive frames */
        }
      }
    }
  }
}

function friendlyStatus(status: number, body: string): AiError {
  if (status === 401 || status === 403)
    return new AiError(
      "The AI key was rejected. Please check that the Gemini API key is correct and that the Generative Language API is enabled for it.",
      status,
    );
  if (status === 429)
    return new AiError("The AI service is rate limited right now. Please wait a moment and try again.", 429);
  if (status === 402)
    return new AiError("The AI account has run out of credit. Please top up to continue.", 402);
  return new AiError(`The AI service returned an error (${status}). ${body.slice(0, 300)}`, status);
}

/** Models tried in order when the primary one is busy or unavailable. */
const GEMINI_FALLBACK_MODELS = [
  GEMINI_CHAT_MODEL,
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
].filter((m, i, all) => all.indexOf(m) === i);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls Gemini's OpenAI-compatible chat endpoint, retrying transient
 * failures (429/5xx) with backoff and falling back to other models.
 */
async function geminiChat(
  messages: ChatMessage[],
  stream: boolean,
): Promise<Response> {
  let last: { status: number; body: string } | null = null;

  for (const model of GEMINI_FALLBACK_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${GEMINI_BASE}/openai/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env["GEMINI_API_KEY"]}`,
        },
        body: JSON.stringify({ model, messages, ...(stream ? { stream: true } : {}) }),
      });
      if (res.ok) return res;

      const body = await res.text();
      last = { status: res.status, body };
      // Key/permission and request problems will not improve by retrying.
      if (res.status === 401 || res.status === 403 || res.status === 400) {
        throw friendlyStatus(res.status, body);
      }
      // Model missing/retired: move straight to the next model.
      if (res.status === 404) break;
      if (res.status === 429 || res.status >= 500) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      throw friendlyStatus(res.status, body);
    }
  }

  if (last && (last.status === 429 || last.status >= 500)) {
    throw new AiError(
      "The AI service is busy at the moment. Please send your question again in a few seconds.",
      503,
    );
  }
  throw friendlyStatus(last?.status ?? 503, last?.body ?? "");
}

/** Streams an answer as plain text chunks. */
export async function streamAnswer(messages: ChatMessage[]): Promise<ReadableStream<Uint8Array>> {
  const provider = aiProvider();
  if (provider === "none")
    throw new AiError(
      "No AI key is configured. Add your Google Gemini API key to enable answers.",
      503,
    );

  const encoder = new TextEncoder();

  if (provider === "gemini") {
    const res = await fetch(`${GEMINI_BASE}/openai/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env["GEMINI_API_KEY"]}`,
      },
      body: JSON.stringify({ model: GEMINI_CHAT_MODEL, messages, stream: true }),
    });
    if (!res.ok) throw friendlyStatus(res.status, await res.text());

    return new ReadableStream({
      async start(controller) {
        try {
          for await (const event of sseEvents(res)) {
            const delta = (event as { choices?: { delta?: { content?: string } }[] }).choices?.[0]
              ?.delta?.content;
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        } catch (error) {
          console.error("Gemini stream failed", error);
        } finally {
          controller.close();
        }
      },
    });
  }

  // Fallback: Lovable AI Gateway Responses API (always streaming).
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const input = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
    }));

  const res = await fetch(`${GATEWAY_BASE}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": process.env["LOVABLE_API_KEY"]!,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      instructions: system,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
    }),
  });
  if (!res.ok) throw friendlyStatus(res.status, await res.text());

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of sseEvents(res)) {
          const e = event as { type?: string; delta?: string };
          if (e.type === "response.output_text.delta" && e.delta)
            controller.enqueue(encoder.encode(e.delta));
        }
      } catch (error) {
        console.error("Gateway stream failed", error);
      } finally {
        controller.close();
      }
    },
  });
}

/** Non-streaming completion, used for chat titles and query expansion. */
export async function completeText(messages: ChatMessage[]): Promise<string> {
  const provider = aiProvider();
  if (provider === "none") return "";
  if (provider === "gemini") {
    const res = await fetch(`${GEMINI_BASE}/openai/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env["GEMINI_API_KEY"]}`,
      },
      body: JSON.stringify({ model: GEMINI_CHAT_MODEL, messages }),
    });
    if (!res.ok) throw friendlyStatus(res.status, await res.text());
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }
  const stream = await streamAnswer(messages);
  const text = await new Response(stream).text();
  return text.trim();
}

/** Embeds one text into a 3072-dimension vector. */
export async function embedText(
  text: string,
  kind: "document" | "query" = "document",
): Promise<number[] | null> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 8000);
  if (!clean) return null;
  const provider = aiProvider();

  if (provider === "gemini") {
    const res = await fetch(
      `${GEMINI_BASE}/models/${GEMINI_EMBED_MODEL}:embedContent?key=${process.env["GEMINI_API_KEY"]}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${GEMINI_EMBED_MODEL}`,
          content: { parts: [{ text: clean }] },
          taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          outputDimensionality: EMBED_DIMENSIONS,
        }),
      },
    );
    if (!res.ok) throw friendlyStatus(res.status, await res.text());
    const json = (await res.json()) as { embedding?: { values?: number[] } };
    return json.embedding?.values ?? null;
  }

  if (provider === "gateway") {
    const res = await fetch(`${GATEWAY_BASE}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
      },
      body: JSON.stringify({ model: "google/gemini-embedding-2", input: clean }),
    });
    if (!res.ok) throw friendlyStatus(res.status, await res.text());
    const json = (await res.json()) as { data?: { embedding?: number[] }[] };
    return json.data?.[0]?.embedding ?? null;
  }

  return null;
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < view.length; i += step) {
    binary += String.fromCharCode(...view.subarray(i, i + step));
  }
  return btoa(binary);
}

/**
 * Reads a scanned document with the model's vision ability (OCR fallback).
 * Returns plain text with `[ص N]` page markers, or "" when unavailable.
 */
export async function transcribeDocument(
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) return "";
  if (bytes.byteLength > 18 * 1024 * 1024) return "";

  const prompt =
    "Transcribe every word of this book scan exactly as printed, preserving the original Arabic script and line order. " +
    "Start each page with a marker line of the form [ص N] where N is the printed page number if visible, otherwise the sequential page number. " +
    "Put chapter headings (باب / فصل / كتاب) on their own line. Output only the transcription, no commentary.";

  const res = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_CHAT_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: mimeType || "application/pdf", data: toBase64(bytes) } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 32768 },
      }),
    },
  );
  if (!res.ok) {
    console.error("OCR transcription failed", res.status, (await res.text()).slice(0, 300));
    return "";
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}
