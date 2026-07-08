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

  if (entry.requestedAmountUsdc) lines.push(`| Requested | ${entry.requestedAmountUsdc} USDC |`);
  if (entry.clampedAmountUsdc) lines.push(`| Executed | ${entry.clampedAmountUsdc} USDC |`);
  if (entry.boundBy) lines.push(`| Bound by | ${entry.boundBy} |`);
  if (entry.walletUsdcBalance) lines.push(`| Balance | ${entry.walletUsdcBalance} USDC |`);
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
  if (entry.clampedAmountUsdc) fields.push({ name: "Amount", value: `${entry.clampedAmountUsdc} USDC`, inline: true });
  if (entry.walletUsdcBalance) fields.push({ name: "Balance", value: `${entry.walletUsdcBalance} USDC`, inline: true });
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

export async function notifyAll(entry: HistoryEntry, webhookUrl?: string): Promise<void> {
  await Promise.allSettled([
    writeJobSummary(entry),
    notifyDiscord(entry, webhookUrl),
  ]).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") logger.warn(`Notification failed: ${r.reason}`);
    }
  });
}
