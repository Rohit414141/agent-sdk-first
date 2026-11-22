import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import fs from "node:fs/promises";
import { env } from "./env.ts";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const MODEL = "claude-opus-5-5";

// Runs one "agent": a system prompt + tools, looped by the SDK tool runner
// until Claude stops calling tools. Returns the final text reply.
async function runAgent(
  system: string,
  tools: Parameters<typeof client.beta.messages.toolRunner>[0]["tools"],
  query: string,
): Promise<string> {
  const finalMessage = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    system,
    tools,
    messages: [{ role: "user", content: query }],
    // If the request is declined by a safety classifier, retry on a fallback model
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (finalMessage.stop_reason === "refusal") {
    return `Request declined: ${finalMessage.stop_details?.explanation ?? "no reason given"}`;
  }

  return finalMessage.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// --- Tools ---

const fetchAvailablePlans = betaZodTool({
  name: "fetch_available_plans",
  description: "fetches the available plans for internet",
  inputSchema: z.object({}),
  run: async () => {
    const plans = [
      { plan_id: "1", price_inr: 399, speed: "30MB/s" },
      { plan_id: "2", price_inr: 999, speed: "100MB/s" },
      { plan_id: "3", price_inr: 1499, speed: "200MB/s" },
    ];
    return JSON.stringify(plans);
  },
});

const processRefund = betaZodTool({
  name: "process_refund",
  description: "This tool processes the refund for a customer",
  inputSchema: z.object({
    customerId: z.string().describe("id of the customer"),
    reason: z.string().describe("reason for refund"),
  }),
  run: async ({ customerId, reason }) => {
    await fs.appendFile(
      "./refunds.txt",
      `Refund for Customer having ID ${customerId} for ${reason}\n`,
      "utf-8",
    );
    return JSON.stringify({ refundIssued: true });
  },
});

// --- Agents ---

const REFUND_AGENT_INSTRUCTIONS =
  "You are expert in issuing refunds to the customer";

const SALES_AGENT_INSTRUCTIONS = `
You are an expert sales agent for an internet broadband company.
Talk to the user and help them with what they need.
`.trim();

// Refund agent exposed as a tool (OpenAI `refundAgent.asTool(...)`):
// the sales agent sends it a request, it runs its own tool loop, and its
// final reply comes back as the tool result.
const refundExpert = betaZodTool({
  name: "refund_expert",
  description: "Handles refund questions and requests.",
  inputSchema: z.object({
    input: z
      .string()
      .describe(
        "the refund request, including the customer id, plan and reason",
      ),
  }),
  run: async ({ input }) =>
    runAgent(REFUND_AGENT_INSTRUCTIONS, [processRefund], input),
});

async function main(query = "") {
  const reply = await runAgent(
    SALES_AGENT_INSTRUCTIONS,
    [fetchAvailablePlans, refundExpert],
    query,
  );
  console.log(reply);
}

main(
  `I had a plan 399. I need a refund right now. my cus id is cust123 because of I am shifting to a new place`,
);
