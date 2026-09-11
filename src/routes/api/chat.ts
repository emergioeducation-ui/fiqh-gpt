import { createFileRoute } from "@tanstack/react-router";

import { AiError, completeText, streamAnswer, type ChatMessage } from "@/lib/ai.server";
import { publicDb } from "@/lib/db.server";
import { contextBlock, systemPrompt } from "@/lib/prompts.server";
import {
  formatContext,
  formatSchoolContext,
  retrievePassages,
  retrievePerSchool,
  type Mode,
  type Passage,
  type School,
} from "@/lib/retrieval.server";
import { calculateFaraid, faraidSummary, formatF, toNumber, type HeirInput } from "@/lib/faraid";
import { DEFAULT_ZAKAT_SETTINGS, zakatSummary, type ZakatSettings } from "@/lib/zakat";

type Incoming = {
  mode?: Mode;
  school?: School;
  messages?: { role: "user" | "assistant"; content: string }[];
};

const MODES: Mode[] = ["fatwa", "faraid", "zakat"];
const SCHOOLS: School[] = ["general", "shafii", "hanafi", "maliki", "hanbali"];

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function loadZakatSettings(): Promise<ZakatSettings> {
  try {
    const { data } = await publicDb().from("zakat_settings").select("key, value");
    if (!data) return DEFAULT_ZAKAT_SETTINGS;
    const map = Object.fromEntries(data.map((r) => [r.key, Number(r.value)]));
    return { ...DEFAULT_ZAKAT_SETTINGS, ...map } as ZakatSettings;
  } catch {
    return DEFAULT_ZAKAT_SETTINGS;
  }
}

/** Asks the model to pull structured numbers out of the question, for the calculators. */
async function extractJson(instruction: string, question: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await completeText([
      { role: "system", content: `${instruction}\nReply with JSON only — no prose, no code fences.` },
      { role: "user", content: question },
    ]);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch (error) {
    console.error("Structured extraction failed", error);
    return null;
  }
}

const FARAID_INSTRUCTION = `Extract the surviving heirs from the user's inheritance question.
Return JSON with these optional numeric keys (omit or 0 when absent):
husband, wives, father, mother, paternalGrandfather, grandmothers, sons, daughters, grandsons,
granddaughters, fullBrothers, fullSisters, paternalBrothers, paternalSisters, maternalSiblings,
and estateValue (the total estate as a plain number, 0 if not stated).
Also return "hasHeirs": true only when the question actually names surviving relatives.`;

const ZAKAT_INSTRUCTION = `Extract zakat figures from the user's question.
Return JSON with these optional numeric keys (0 when absent): cash, bankBalance, goldGrams,
silverGrams, tradeGoods, receivables, investments, debts, people (household members for zakat al-fitr).
Also return "nisabBasis": "silver" or "gold" (default "silver"), "hasWealth": true when any wealth
figure was given, and "hasFitr": true when the question concerns zakat al-fitr / per-person zakat.`;

async function buildCalculationBlock(mode: Mode, question: string): Promise<string> {
  if (mode === "faraid") {
    const parsed = await extractJson(FARAID_INSTRUCTION, question);
    if (!parsed || parsed["hasHeirs"] !== true) return "";
    const estateValue = Number(parsed["estateValue"]) || 0;
    const input = parsed as unknown as HeirInput;
    const result = calculateFaraid(input);
    if (result.heirs.length === 0) return "";
    const table = result.heirs
      .map(
        (h) =>
          `| ${h.label} (${h.labelArabic}) | ${h.count} | ${formatF(h.share)} | ${(toNumber(h.share) * 100).toFixed(2)}% | ${
            estateValue > 0 ? (toNumber(h.share) * estateValue).toFixed(2) : "—"
          } |`,
      )
      .join("\n");
    return `CALCULATION BLOCK (verified by this app's faraid engine — use these numbers exactly):
${faraidSummary(input, estateValue)}

Ready-made table rows (heir | count | fraction | percent | amount):
${table}`;
  }

  if (mode === "zakat") {
    const parsed = await extractJson(ZAKAT_INSTRUCTION, question);
    if (!parsed) return "";
    const settings = await loadZakatSettings();
    const wealth = parsed["hasWealth"] === true ? (parsed as never) : null;
    const fitr = parsed["hasFitr"] === true ? { people: Number(parsed["people"]) || 1 } : null;
    if (!wealth && !fitr) return "";
    const summary = zakatSummary(wealth, fitr, settings);
    if (!summary) return "";
    return `CALCULATION BLOCK (verified by this app's zakat engine — use these numbers exactly):
${summary}
Rates in use: gold ${settings.gold_price_per_gram}/g, silver ${settings.silver_price_per_gram}/g, nisab of gold ${settings.gold_nisab_grams} g, nisab of silver ${settings.silver_nisab_grams} g.`;
  }

  return "";
}

async function logUsage(mode: Mode, school: School, question: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("usage_events").insert({ mode, school, question: question.slice(0, 500) });
  } catch (error) {
    console.error("Usage logging failed", error);
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Incoming;
        try {
          body = (await request.json()) as Incoming;
        } catch {
          return jsonError("Invalid request body.", 400);
        }

        const mode: Mode = MODES.includes(body.mode as Mode) ? (body.mode as Mode) : "fatwa";
        const school: School = SCHOOLS.includes(body.school as School)
          ? (body.school as School)
          : "general";
        const history = (body.messages ?? []).filter(
          (m) => typeof m?.content === "string" && m.content.trim().length > 0,
        );
        const question = [...history].reverse().find((m) => m.role === "user")?.content?.trim();
        if (!question) return jsonError("Please type a question first.", 400);

        try {
          let context = "";
          let passages: Passage[] = [];

          if (mode === "fatwa" && school === "general") {
            const grouped = await retrievePerSchool(question, mode, 4);
            const formatted = formatSchoolContext(grouped);
            context = formatted.context;
            passages = formatted.all;
          } else {
            passages = await retrievePassages(question, mode, school, 10);
            context = formatContext(passages);
          }

          const calculation = await buildCalculationBlock(mode, question);

          const messages: ChatMessage[] = [
            { role: "system", content: systemPrompt(mode, school) },
            { role: "system", content: contextBlock(context) },
          ];
          if (calculation) messages.push({ role: "system", content: calculation });
          for (const m of history.slice(-12)) messages.push({ role: m.role, content: m.content });

          const stream = await streamAnswer(messages);
          void logUsage(mode, school, question);

          return new Response(stream, {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
              "x-passage-count": String(passages.length),
            },
          });
        } catch (error) {
          if (error instanceof AiError) return jsonError(error.message, error.status);
          console.error("Chat failed", error);
          return jsonError("Something went wrong while preparing the answer. Please try again.", 500);
        }
      },
    },
  },
});
