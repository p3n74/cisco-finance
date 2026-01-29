import nodemailer from "nodemailer";
import { env } from "@cisco-finance/env/server";

const transporter = nodemailer.createTransport({
  service: env.EMAIL_PROVIDER,
  auth: {
    user: env.EMAIL_FROM,
    pass: env.EMAIL_PASSWORD,
  },
});

export const sendEmail = async (to: string, subject: string, html: string) => {
  try {
    const info = await transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    console.log("Message sent: %s", info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    // Don't throw, just log so we don't break the request if email fails
    return null;
  }
};
