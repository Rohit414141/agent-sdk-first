import nodemailer from "nodemailer";
import { z } from "zod";
import "./env.ts"; // loads .env via dotenv

// Email settings from .env
export const emailEnv = z
  .object({
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().default(465),
    SMTP_USER: z.string().min(1),
    SMTP_PASS: z.string().min(1),
    EMAIL_TO: z.email(),
  })
  .parse(process.env);

const transporter = nodemailer.createTransport({
  host: emailEnv.SMTP_HOST,
  port: emailEnv.SMTP_PORT,
  secure: emailEnv.SMTP_PORT === 465, // 465 = SSL, 587 = STARTTLS
  auth: { user: emailEnv.SMTP_USER, pass: emailEnv.SMTP_PASS },
});

// Added to the end of every email
const EMAIL_SIGNATURE = "\n\nRegards,\nRahane One Agent";

export async function sendEmail(opts: {
  to?: string;
  subject: string;
  body: string;
}): Promise<string> {
  const to = opts.to || emailEnv.EMAIL_TO;
  const info = await transporter.sendMail({
    from: emailEnv.SMTP_USER,
    to,
    subject: opts.subject,
    text: opts.body.trimEnd() + EMAIL_SIGNATURE,
  });
  console.log(`[email] sent to ${to} (id: ${info.messageId})`);
  return to;
}
