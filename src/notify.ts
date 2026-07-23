import { appendFile } from "node:fs/promises";
import type { HistoryEntry } from "./types.js";
import { logger } from "./logger.js";

const STATUS_EMOJI: Record<string, string> = {
  success: "✅",
  dry_run: "🧪",
  skipped_insufficient_balance: "⏭️",
  skipped_llm_declined: "⏭️",
  skipped_guardrail_clamped: "⏭️",
  error_rpc: "❌",
  error_llm_api: "❌",
  error_llm_invalid_output: "❌",
  error_swap_failed: "❌",
  error_config: "❌",
  error_unexpected: "❌",
};

function buildMarkdown(entry: HistoryEntry): string {
  const emoji = STATUS_EMOJI[entry.status] ?? "❓";
  const lines = [
    `## ${emoji} DCA Run — ${entry.status.replaceAll("_", " ")}`,
    "",
    "| Field | Value |",
    "|-------|-------|",
    `| Date | ${entry.date} |`,
    `| Status | ${entry.status} |`,
    `| Token | ${entry.tokenOut} |`,
  ];

  if (entry.requestedAmountUsdc) lines.push(`| Requested | ${fmtAmt(entry.requestedAmountUsdc)} USDC |`);
  if (entry.clampedAmountUsdc) lines.push(`| Executed | ${fmtAmt(entry.clampedAmountUsdc)} USDC |`);
  if (entry.boundBy) lines.push(`| Bound by | ${entry.boundBy} |`);
  if (entry.walletUsdcBalance) lines.push(`| Balance | ${fmtAmt(entry.walletUsdcBalance)} USDC |`);
  if (entry.txHash) {
    const link = entry.explorerUrl ? `[${entry.txHash.slice(0, 10)}…](${entry.explorerUrl})` : entry.txHash;
    lines.push(`| Tx | ${link} |`);
  }

  lines.push("");
  if (entry.reasoning) lines.push(`> **Reasoning:** ${entry.reasoning}`, "");
  if (entry.message) lines.push(`> ${entry.message}`, "");

  return lines.join("\n");
}

export async function writeJobSummary(entry: HistoryEntry): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  await appendFile(summaryPath, buildMarkdown(entry) + "\n");
}

export async function notifyDiscord(entry: HistoryEntry, webhookUrl?: string): Promise<void> {
  if (!webhookUrl) return;

  const emoji = STATUS_EMOJI[entry.status] ?? "❓";
  const isError = entry.status.startsWith("error_");
  const color = isError ? 0xff4444 : entry.status === "success" ? 0x34d399 : 0xf5a524;

  const fields = [
    { name: "Status", value: `${emoji} ${entry.status}`, inline: true },
    { name: "Token", value: entry.tokenOut, inline: true },
  ];
  if (entry.clampedAmountUsdc) fields.push({ name: "Amount", value: `${fmtAmt(entry.clampedAmountUsdc)} USDC`, inline: true });
  if (entry.walletUsdcBalance) fields.push({ name: "Balance", value: `${fmtAmt(entry.walletUsdcBalance)} USDC`, inline: true });
  if (entry.txHash) {
    const link = entry.explorerUrl ? `[View](${entry.explorerUrl})` : entry.txHash;
    fields.push({ name: "Tx", value: link, inline: true });
  }
  if (entry.message) fields.push({ name: "Details", value: entry.message.slice(0, 1024), inline: false });

  const payload = {
    embeds: [{
      title: `Aura DCA Agent — ${entry.status.replaceAll("_", " ")}`,
      color,
      fields,
      timestamp: entry.timestamp,
      ...(entry.reasoning ? { footer: { text: entry.reasoning.slice(0, 200) } } : {}),
    }],
  };

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ---- Telegram (server-side, always-on) ----
// Unlike the dashboard's browser notifier (which only fires while a tab is open),
// this runs inside the cron, so the autonomous agent pushes an alert on every run
// regardless of whether anyone is watching. Configured via env/secrets:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and optional TELEGRAM_NOTIFY_ON
//   ("smart" default = success + errors, skipping routine skips; "all"; "errors").

const ARC_EXPLORER = "https://testnet.arcscan.app";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shouldNotifyTelegram(status: string, mode: string): boolean {
  const isError = status.startsWith("error_");
  if (mode === "errors") return isError;
  if (mode === "all") return true;
  // "smart" (default): the events a human actually cares about — a buy landed or
  // something broke — but not routine "nothing due / below min" skips.
  return isError || status === "success" || status === "dry_run";
}

// Arc's native USDC gas token carries 18 decimals, so raw balances read like
// "34.285238006485523924". Trim to something a human can scan, without rounding
// a real amount away to zero.
function fmtAmt(v: string | undefined, dp = 4): string {
  const n = Number.parseFloat(v ?? "");
  if (!Number.isFinite(n)) return String(v ?? "");
  const s = n.toFixed(dp).replace(/\.?0+$/, "");
  // Never round a real amount down to "0" — show dust raw rather than lie.
  if (n > 0 && Number.parseFloat(s) === 0) return String(v);
  return s;
}

function buildTelegramHtml(entry: HistoryEntry): string {
  const emoji = STATUS_EMOJI[entry.status] ?? "❓";
  const lines: string[] = [`${emoji} <b>Aura DCA — ${escHtml(entry.status.replaceAll("_", " "))}</b>`];

  // Lead with the number that matters — for a dry run too, where the planned
  // amount is the whole point of the alert.
  const amt = entry.clampedAmountUsdc;
  if ((entry.status === "success" || entry.status === "dry_run") && amt && Number.parseFloat(amt) > 0) {
    const out = entry.amountOut
      ? ` → ${escHtml(fmtAmt(entry.amountOut, 8))} ${escHtml(entry.tokenOut)}`
      : ` → ${escHtml(entry.tokenOut)}`;
    lines.push(`🪙 <b>${escHtml(fmtAmt(amt))} USDC${out}</b>`);
  } else {
    lines.push(`🪙 target: <b>${escHtml(entry.tokenOut)}</b>`);
  }

  const ss = entry.smartSizing;
  if (ss && ss.multiplier != null) {
    const parts = [`${ss.source === "llm" ? "⚡" : ""}🧠 <b>smart ×${ss.multiplier.toFixed(2)}</b>`];
    if (ss.fearGreed != null) parts.push(`F&amp;G ${ss.fearGreed}`);
    if (ss.drawdownPct && ss.drawdownPct > 0) parts.push(`dip ${(ss.drawdownPct * 100).toFixed(1)}%`);
    lines.push(parts.join(" · "));
  }

  if (entry.boundBy) lines.push(`🔒 bound by <code>${escHtml(entry.boundBy)}</code>`);
  if (entry.walletUsdcBalance) lines.push(`💰 balance ${escHtml(fmtAmt(entry.walletUsdcBalance))} USDC`);
  if (entry.txHash) {
    const url = entry.explorerUrl || `${ARC_EXPLORER}/tx/${entry.txHash}`;
    lines.push(`🔗 <a href="${escHtml(url)}">tx ${escHtml(entry.txHash.slice(0, 10))}…</a>`);
  }
  const note = entry.reasoning || entry.message;
  if (note) lines.push(`💬 <i>${escHtml(note.slice(0, 350))}</i>`);

  return lines.join("\n");
}

export async function notifyTelegram(entry: HistoryEntry): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return;
  const mode = (process.env.TELEGRAM_NOTIFY_ON?.trim() || "smart").toLowerCase();
  if (!shouldNotifyTelegram(entry.status, mode)) return;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: buildTelegramHtml(entry),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage ${res.status}: ${body.slice(0, 200)}`);
  }
}

export async function notifyAll(entry: HistoryEntry, webhookUrl?: string): Promise<void> {
  await Promise.allSettled([
    writeJobSummary(entry),
    notifyDiscord(entry, webhookUrl),
    notifyTelegram(entry),
  ]).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") logger.warn(`Notification failed: ${r.reason}`);
    }
  });
}
