import dotenv from "dotenv";
import { z } from "zod";

// Load variables from .env into process.env
dotenv.config({ quiet: true });

// Describe the variables this project needs
const envSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, "ANTHROPIC_API_KEY is missing. Add it to your .env file."),
});

// Validate once at startup; exit with a clear message if anything is wrong
const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = result.data;
