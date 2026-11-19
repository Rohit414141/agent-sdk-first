import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "./env.ts";
import { sendEmail } from "./email.ts";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const API_URL = "https://api.aitrender.in/api/v1/fii-dii/pcr-history";

// ---- Validate the API response with zod ----
const PcrValue = z.object({ v: z.number() }).passthrough().nullable();

const RowSchema = z.object({
  date: z.string(),
  expiry: z.string().nullable(),
  pcr: z.object({
    FII: PcrValue,
    CLIENT: PcrValue,
    PRO: PcrValue,
    DII: PcrValue,
    TOTAL: PcrValue,
  }),
  pcr1m: PcrValue,
  pcr3m: PcrValue,
  points: z.object({
    nifty: z.number().nullable(),
    bank: z.number().nullable(),
    sensex: z.number().nullable(),
  }),
});
type Row = z.infer<typeof RowSchema>;

const ResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ rows: z.array(RowSchema) }),
});

// ---- Helpers ----
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchRows(days = 30): Promise<Row[]> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const url = `${API_URL}?from=${isoDate(from)}&to=${isoDate(to)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);

  const rows = ResponseSchema.parse(await res.json()).data.rows;
  // Newest first
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

function pts(n: number | null): string {
  if (n === null) return "n/a";
  return (n > 0 ? "+" : "") + n.toFixed(2);
}

function pcr(v: { v: number } | null): string {
  return v === null ? "n/a" : v.v.toFixed(2);
}

// Exact numbers, built in code (not by the model)
function buildTable(rows: Row[]): string {
  const latest = rows[0]!;
  const lines = [
    `Latest trading day: ${latest.date}${latest.expiry ? ` (${latest.expiry} expiry)` : ""}`,
    "",
    "Index points change",
    `  Nifty       ${pts(latest.points.nifty)}`,
    `  Bank Nifty  ${pts(latest.points.bank)}`,
    `  Sensex      ${pts(latest.points.sensex)}`,
    "",
    "PCR by participant",
    `  FII ${pcr(latest.pcr.FII)} | DII ${pcr(latest.pcr.DII)} | PRO ${pcr(latest.pcr.PRO)} | CLIENT ${pcr(latest.pcr.CLIENT)} | TOTAL ${pcr(latest.pcr.TOTAL)}`,
    `  PCR 1M avg ${pcr(latest.pcr1m)} | PCR 3M avg ${pcr(latest.pcr3m)}`,
    "",
    "Last 5 days (Nifty / Bank Nifty / Sensex)",
    ...rows
      .slice(0, 5)
      .map((r) => `  ${r.date}  ${pts(r.points.nifty)} / ${pts(r.points.bank)} / ${pts(r.points.sensex)}`),
  ];
  return lines.join("\n");
}

// Claude writes the analysis
async function analyse(rows: Row[]): Promise<string> {
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system:
      "You are a market data analyst for Indian indices. Write a short, plain-text analysis " +
      "(no markdown, no tables, no greeting, no sign-off) of the latest trading day: " +
      "Nifty, Bank Nifty and Sensex point changes, how they compare with the previous days, " +
      "and what the participant PCRs (FII, DII, PRO, CLIENT, TOTAL) and 1M/3M averages suggest about positioning. " +
      "A null value means the data is not available; say so instead of guessing. " +
      "Keep it under 200 words. This is informational, not investment advice.",
    messages: [
      {
        role: "user",
        content: `PCR history, newest first (JSON):\n${JSON.stringify(rows.slice(0, 15))}`,
      },
    ],
    // If the request is declined by a safety classifier, retry on a fallback model
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (response.stop_reason === "refusal") {
    return "(Analysis unavailable for this day.)";
  }

  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function main() {
  const rows = await fetchRows();
  if (rows.length === 0) {
    console.log("No data returned by the API. No email sent.");
    return;
  }

  const latest = rows[0]!;
  const table = buildTable(rows);
  const analysis = await analyse(rows);

  const subject =
    `PCR Report ${latest.date}: Nifty ${pts(latest.points.nifty)}, ` +
    `Bank Nifty ${pts(latest.points.bank)}, Sensex ${pts(latest.points.sensex)}`;

  const body = `${table}\n\nAnalysis\n${analysis}`;

  console.log(subject + "\n\n" + body + "\n");
  await sendEmail({ subject, body });
}

main().catch((err) => {
  console.error("PCR report failed:", err);
  process.exit(1);
});
