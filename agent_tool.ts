import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "./env.ts";
import { sendEmail } from "./email.ts";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// Shape of the final answer (OpenAI `outputType`) structured output
const GetWeatherResultSchema = z.object({
  city: z.string().describe("name of the city"),
  degree_c: z.number().describe("the degree celcius of the temp"),
  condition: z
    .string()
    .optional()
    .describe(
      "weather condition only, e.g. 'Sunny' or 'Haze' (no other notes)",
    ),
});

// Tool 1: fetch live weather from wttr.in
const getWeatherTool = betaZodTool({
  name: "get_weather",
  description: "returns the current weather information for the given city",
  inputSchema: z.object({
    city: z.string().describe("name of the city"),
  }),
  run: async ({ city }) => {
    const url = `https://wttr.in/${encodeURIComponent(city.toLowerCase())}?format=%C+%t`;
    const response = await fetch(url);
    const text = await response.text();
    return `The weather of ${city} is ${text}`;
  },
});

// Added to the end of every email
const EMAIL_SIGNATURE = "\n\nRegards,\nRahane One Agent";

// Tool 2: send an email via SMTP
const sendEmailTool = betaZodTool({
  name: "send_email",
  description:
    "Sends an email. Leave toEmail empty to send to the user's own address.",
  inputSchema: z.object({
    toEmail: z
      .string()
      .optional()
      .describe("email address to (optional; defaults to the user's address)"),
    subject: z.string().describe("subject"),
    body: z
      .string()
      .describe(
        "body of the email, without any sign-off or signature (one is added automatically)",
      ),
  }),
  run: async ({ toEmail, subject, body }) => {
    const to = toEmail || emailEnv.EMAIL_TO;
    try {
      const info = await transporter.sendMail({
        from: emailEnv.SMTP_USER,
        to,
        subject,
        text: body.trimEnd() + EMAIL_SIGNATURE,
      });
      console.log(`[send_email] sent to ${to} (id: ${info.messageId})`);
      return `Email sent to ${to}.`;
    } catch (err) {
      // Tell Claude it failed instead of crashing the agent
      return `Failed to send email: ${(err as Error).message}`;
    }
  },
});

async function main(query = "") {
  // The tool runner loops: Claude calls a tool -> SDK runs it -> result goes back -> repeat
  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system:
      "you are an expert weather agent that helps user to tell weather report",
    tools: [getWeatherTool, sendEmailTool],
    output_config: { format: zodOutputFormat(GetWeatherResultSchema) },
    messages: [{ role: "user", content: query }],
    // If the request is declined by a safety classifier, retry on a fallback model
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (finalMessage.stop_reason === "refusal") {
    console.log("Request declined:", finalMessage.stop_details?.explanation);
    return;
  }

  // The final text is JSON matching GetWeatherResultSchema
  const text = finalMessage.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const result = GetWeatherResultSchema.parse(JSON.parse(text));

  console.log("Result:", result.degree_c);
  console.log("Full result:", result);
}

main("What is the weather of Delhi?");
