import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import fs from "node:fs/promises";
import { env } from "./env.ts";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

type Agent = {
  name: string;
  instructions: string;
  tools: any[];
  handoffs?: Agent[];
  handoffDescription?: string;
};
const transferName = (a: Agent) =>
  `transfer_to_${a.name.toLowerCase().replace(/\W+/g, "_")}`;

// Like OpenAI `run(agent, query)`: tool runner loops tools; a transfer_to_* call hands off to that agent
async function run(
  agent: Agent,
  query: string,
): Promise<{ finalOutput: string; lastAgent: Agent }> {
  const handoffTools = (agent.handoffs ?? []).map((a) =>
    betaZodTool({
      name: transferName(a),
      description: a.handoffDescription ?? a.name,
      inputSchema: z.object({}),
      run: async () => "",
    }),
  );
  const runner = client.beta.messages.toolRunner({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: agent.instructions,
    tools: [...agent.tools, ...handoffTools],
    messages: [{ role: "user", content: query }],
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // retry on a fallback model if a safety classifier declines
  });
  let text = "";
  for await (const message of runner) {
    const handoff = (agent.handoffs ?? []).find((a) =>
      message.content.some(
        (b) => b.type === "tool_use" && b.name === transferName(a),
      ),
    );
    if (handoff) return run(handoff, query);
    text = message.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
  }
  return { finalOutput: text, lastAgent: agent };
}

// Refund Agent
const processRefund = betaZodTool({
  name: "process_refund",
  description: `This tool processes the refund for a customer`,
  inputSchema: z.object({
    customerId: z.string().describe("id of the customer"),
    reason: z.string().describe("reason for refund"),
  }),
  run: async function ({ customerId, reason }) {
    await fs.appendFile(
      "./refunds.txt",
      `Refund for Customer having ID ${customerId} for ${reason}\n`,
      "utf-8",
    );
    return JSON.stringify({ refundIssued: true });
  },
});

const refundAgent: Agent = {
  name: "Refund Agent",
  instructions: `You are expert in issuing refunds to the customer`,
  tools: [processRefund],
  handoffDescription:
    "Expert in handling user queries for existing customers and issue refunds and help them",
};

// Sales Agent
const fetchAvailablePlans = betaZodTool({
  name: "fetch_available_plans",
  description: "fetches the available plans for internet",
  inputSchema: z.object({}),
  run: async function () {
    return JSON.stringify([
      { plan_id: "1", price_inr: 399, speed: "30MB/s" },
      { plan_id: "2", price_inr: 999, speed: "100MB/s" },
      { plan_id: "3", price_inr: 1499, speed: "200MB/s" },
    ]);
  },
});

const salesAgent: Agent = {
  name: "Sales Agent",
  instructions: `
          You are an expert sales agent for an internet broadband company.
          Talk to the user and help them with what they need.
      `,
  tools: [
    fetchAvailablePlans,
    // refundAgent.asTool(...)
    betaZodTool({
      name: "refund_expert",
      description: "Handles refund questions and requests.",
      inputSchema: z.object({
        input: z.string().describe("the refund request"),
      }),
      run: async ({ input }) => (await run(refundAgent, input)).finalOutput,
    }),
  ],
  handoffDescription:
    "Expert in handling queries like all plans and pricing available. Good for new customers.",
};

const receptionAgent: Agent = {
  name: "Reception Agent",
  instructions: `You are the customer facing agent expert in understanding what customer needs and then route them or handoff them to the right agent using the transfer_to_* tools`,
  tools: [],
  handoffs: [salesAgent, refundAgent],
};

async function main(query = "") {
  const result = await run(receptionAgent, query);
  console.log(`Handled by`, result.lastAgent.name);
  console.log(`Result`, result.finalOutput);
}

main(
  `Hi There, I am customer having id cust_234 and I want to have a refund request as I am facing slow speed internet issues.`,
);
