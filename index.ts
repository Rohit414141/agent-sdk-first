import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.ts";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const location: string = "india";
// Dynamic instructions -> Claude's `system` prompt
function getInstructions(): string {
  if (location == "india") {
    return "Always say namaste and then You are an agent that always says with users name";
  }
  return "That just talk to the user";
}

async function runHelloAgent(input: string): Promise<string> {
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: getInstructions(),
    messages: [{ role: "user", content: input }],
    // If the request is declined by a safety classifier, retry on a fallback model
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (response.stop_reason === "refusal") {
    return `Request declined: ${response.stop_details?.explanation ?? "no details"}`;
  }

  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

runHelloAgent("Hey There, My name is Rohit Mishra").then((finalOutput) => {
  console.log(finalOutput);
});
