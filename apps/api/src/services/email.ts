import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

/**
 * Email alerting. Provider-agnostic over plain HTTPS so we add no dependency:
 * supports Resend and SendGrid, selected by whichever key is configured.
 * Silently no-ops when unconfigured — an alert must never break ingestion.
 */

export interface EmailAlert {
  subject: string;
  heading: string;
  body: string;
  facts: { label: string; value: string }[];
  linkUrl?: string;
  linkLabel?: string;
  severity: "critical" | "high" | "medium";
}

const SEV_COLOR: Record<string, string> = {
  critical: "#dc2626",
  high: "#d97706",
  medium: "#6b7280",
};

function renderHtml(a: EmailAlert): string {
  const rows = a.facts
    .map(
      (f) =>
        `<tr><td style="padding:6px 12px;color:#6b7280;font:12px ui-monospace,monospace">${f.label}</td>` +
        `<td style="padding:6px 12px;color:#111827;font:12px ui-monospace,monospace">${escapeHtml(f.value)}</td></tr>`
    )
    .join("");
  const cta = a.linkUrl
    ? `<a href="${a.linkUrl}" style="display:inline-block;margin-top:20px;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;font:600 13px system-ui">${a.linkLabel ?? "Open in Causal"}</a>`
    : "";
  return `<div style="max-width:560px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif">
  <div style="border-left:3px solid ${SEV_COLOR[a.severity] ?? "#6b7280"};padding-left:14px;margin-bottom:18px">
    <div style="font:600 11px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:${SEV_COLOR[a.severity] ?? "#6b7280"}">${a.severity}</div>
    <h2 style="margin:6px 0 0;font-size:18px;color:#111827">${escapeHtml(a.heading)}</h2>
  </div>
  <p style="color:#374151;font-size:14px;line-height:1.6">${escapeHtml(a.body)}</p>
  <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:6px;margin-top:16px">${rows}</table>
  ${cta}
  <p style="margin-top:24px;color:#9ca3af;font-size:11px">Sent by Causal · you are receiving this because a detector fired on your project.</p>
</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

/** Send an alert email. Returns true when it was actually dispatched. */
export async function sendEmailAlert(fastify: FastifyInstance, alert: EmailAlert): Promise<boolean> {
  const to = config.ALERT_EMAIL_TO;
  if (!to) return false;

  const html = renderHtml(alert);
  const from = config.ALERT_EMAIL_FROM;

  try {
    if (config.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()), subject: alert.subject, html }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return true;
    }

    if (config.SENDGRID_API_KEY) {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { authorization: `Bearer ${config.SENDGRID_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: to.split(",").map((e) => ({ email: e.trim() })) }],
          from: { email: from },
          subject: alert.subject,
          content: [{ type: "text/html", value: html }],
        }),
      });
      if (!res.ok) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return true;
    }
  } catch (err) {
    fastify.log.warn({ err }, "email alert failed");
  }
  return false;
}
