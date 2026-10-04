import nodemailer from "nodemailer";
import { env } from "../config/env.js";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class DevelopmentEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    console.info(JSON.stringify({
      level: "info",
      event: "email.development_delivery",
      to: message.to,
      subject: message.subject,
      text: message.text,
    }));
  }
}

class SmtpEmailProvider implements EmailProvider {
  private readonly transporter;

  constructor(url: string) {
    this.transporter = nodemailer.createTransport(url);
  }

  async send(message: EmailMessage) {
    await this.transporter.sendMail({ from: env.EMAIL_FROM, ...message });
  }
}

const provider: EmailProvider = env.EMAIL_PROVIDER === "smtp" && env.SMTP_URL
  ? new SmtpEmailProvider(env.SMTP_URL)
  : new DevelopmentEmailProvider();

const link = (path: string, token: string) => {
  const url = new URL(path, env.WEB_ORIGIN);
  url.searchParams.set("token", token);
  return url.toString();
};

export async function sendVerificationEmail(input: { email: string; firstName: string; token: string }) {
  const verificationUrl = link("/verify-email", input.token);
  await provider.send({
    to: input.email,
    subject: "Verify your SmartRetail account",
    text: `Hello ${input.firstName}, verify your SmartRetail account: ${verificationUrl}`,
    html: `<p>Hello ${input.firstName},</p><p><a href="${verificationUrl}">Verify your SmartRetail account</a>.</p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(input: { email: string; firstName: string; token: string }) {
  const resetUrl = link("/reset-password", input.token);
  await provider.send({
    to: input.email,
    subject: "Reset your SmartRetail password",
    text: `Hello ${input.firstName}, reset your SmartRetail password: ${resetUrl}`,
    html: `<p>Hello ${input.firstName},</p><p><a href="${resetUrl}">Reset your SmartRetail password</a>.</p><p>This link expires in one hour. Ignore this message if you did not request it.</p>`,
  });
}
