import type { AppConfig } from "./config.js";
import { createWallet } from "./wallet.js";
import { readHistory, appendEntry, recentHistory, dayCount, alreadySpentToday, remainingCampaignBudget, outageStreak } from "./history/store.js";
import { readReflections, appendReflection } from "./history/reflectionStore.js";
import { readLedger, writeLedger, ensureDefaultRates } from "./ledger/store.js";
import { scanDeposits } from "./ledger/scanner.js";
import { computeScheduledSpends, applyScheduledDistribution, applySimulatedDistribution, groupSpendsByToken, smartSizeMultiplier, activeDailyBudgetTotal, splitScheduledBySettlement } from "./ledger/schedule.js";
import { computeAllowanceSpends, pullUsdcFromUser, sendTokenToUser } from "./ledger/allowance.js";
import { requestWithdrawal, processPendingWithdrawals } from "./ledger/withdraw.js";
import { ARC_TESTNET_RPC, ARC_USDC_CONTRACT, ARC_CIRBTC_CONTRACT, dcaTokenInfo } from "./ledger/constants.js";
import { getClaudeDecision } from "./decision/client.js";
import { clampDecision } from "./decision/guardrails.js";
import { proposeSmartMultiplier } from "./decision/sizing.js";
import { generateReflection } from "./decision/reflect.js";
import { runMarketAnalyst } from "./decision/analyst.js";
import { fetchAllMarketData } from "./market/external.js";
import { fetchCirBtcPriceUsd } from "./price/priceFeed.js";
import { readPrices, appendPrice } from "./price/priceStore.js";
import { executeSwap, SwapExecutionError } from "./swap/swapKit.js";
import { payForMarketBriefBestEffort } from "./x402/agent.js";
import type { ClampedDecision, DecisionContext, HistoryEntry, Ledger, RunStatus } from "./types.js";
import { logger } from "./logger.js";
import { notifyAll } from "./notify.js";

export interface RunOutcome {
  entry: HistoryEntry;
  isFatal: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function today(): string {
  return nowIso().slice(0, 10);
}

async function writeAndReturn(
  entry: HistoryEntry,
  isFatal = false,
  discordWebhookUrl?: string,
  reflectionCtx?: { apiKey: string; allHistory: HistoryEntry[] },
): Promise<RunOutcome> {
  await appendEntry(entry);
  await notifyAll(entry, discordWebhookUrl);
  if (reflectionCtx) {
    const updatedHistory = [...reflectionCtx.allHistory, entry];
    const reflection = await generateReflection(
      reflectionCtx.apiKey,
      entry,
      updatedHistory.slice(-8),
      updatedHistory,
    );
    if (reflection) {
      await appendReflection(reflection);
      logger.info(`Reflection saved: ${reflection.insight.slice(0, 80)}…`);
    }
  }
  return { entry, isFatal };
}

/**
 * Emit one run that produced several history entries — one per token group in a
 * multi-token run. Appends and notifies each, then reflects ONCE for the whole
 * run (reflection is an AI call), on the last entry as the representative
 * outcome. Returns that entry as the run's RunOutcome.
 */
async function emitRunEntries(
  entries: HistoryEntry[],
  discordWebhookUrl?: string,
  reflectionCtx?: { apiKey: string; allHistory: HistoryEntry[] },
): Promise<RunOutcome> {
  for (const e of entries) {
    await appendEntry(e);
    await notifyAll(e, discordWebhookUrl);
  }
  const primary = entries[entries.length - 1]!;
  if (reflectionCtx && entries.length > 0) {
    const updatedHistory = [...reflectionCtx.allHistory, ...entries];
    const reflection = await generateReflection(reflectionCtx.apiKey, primary, updatedHistory.slice(-8), updatedHistory);
    if (reflection) {
      await appendReflection(reflection);
      logger.info(`Reflection saved: ${reflection.insight.slice(0, 80)}…`);
    }
  }
  return { entry: primary, isFatal: false };
}

async function saveLedger(ledger: Ledger): Promise<void> {
  try {
    await writeLedger(ledger);
  } catch (err) {
    logger.error("Failed to write ledger", err);
  }
}

/**
 * Return already-pulled USDC to each user's wallet. Called on the allowance-mode
 * failure paths that happen BEFORE the swap settles (sub-min total, swap threw),
 * where the pulled USDC still sits in the agent wallet as USDC — so it can be
 * sent straight back. Without this the transferFrom'd USDC would be silently
 * stranded in the agent wallet (#5). Best-effort per user; a failed refund is
 * logged loudly (the funds are recoverable manually) and counted.
 */
async function refundPulledUsdc(
  config: AppConfig,
  pulled: Array<{ user: string; amount: number }>,
): Promise<{ refunded: number; failed: number }> {
  let refunded = 0;
  let failed = 0;
  for (const p of pulled) {
    if (!(p.amount > 0)) continue;
    try {
      await sendTokenToUser({
        apiKey: config.circleApiKey, entitySecret: config.circleEntitySecret, walletId: config.walletId,
        tokenContract: ARC_USDC_CONTRACT, user: p.user, amount: p.amount.toFixed(6),
      });
      refunded += p.amount;
      logger.info(`Refunded ${p.amount.toFixed(6)} USDC to ${p.user} after an allowance-mode abort`);
    } catch (err) {
      failed += 1;
      logger.error(`USDC REFUND FAILED for ${p.user} — ${p.amount.toFixed(6)} USDC left in the agent wallet, needs manual return`, err);
    }
  }
  return { refunded, failed };
}

export async function runDailyDca(config: AppConfig): Promise<RunOutcome> {
  const date = today();
  const timestamp = nowIso();

  let usdcBalance: string;
  let wallet;
  try {
    wallet = await createWallet(config.circleApiKey, config.circleEntitySecret, config.walletId);
    usdcBalance = await wallet.getUsdcTokenBalance();
  } catch (err) {
    logger.error("Failed to read wallet USDC balance", err);
    return writeAndReturn({
      date,
      timestamp,
      status: "error_rpc",
      tokenOut: config.tokenOut,
      message: `Circle Wallets balance check failed: ${(err as Error).message}`,
    }, false, config.discordWebhookUrl);
  }

  // --- Per-user ledger: scan deposits + process withdrawals ---
  const ledger = await readLedger();

  try {
    await scanDeposits(ledger, wallet.address, ARC_TESTNET_RPC, ARC_USDC_CONTRACT);
  } catch (err) {
    logger.error("Deposit scan failed (non-fatal)", err);
  }

  // Back-fill default rates for accounts that predate per-user DCA.
  const filled = ensureDefaultRates(ledger);
  if (filled > 0) logger.info(`Back-filled default DCA rate for ${filled} pre-existing user(s)`);

  if (config.withdrawalInput) {
    try {
      requestWithdrawal(ledger, config.withdrawalInput.address, config.withdrawalInput.token, config.withdrawalInput.amount);
    } catch (err) {
      logger.error("Withdrawal request failed", err);
    }
  }

  try {
    await processPendingWithdrawals(ledger, wallet);
  } catch (err) {
    logger.error("Withdrawal processing failed (non-fatal)", err);
  }

  await saveLedger(ledger);

  // --- Existing DCA flow ---
  const history = await readHistory();
  const reflections = await readReflections();
  const refCtx = { apiKey: config.anthropicApiKey, allHistory: history };

  // --- Multi-agent: fetch external data + run Market Analyst ---
  logger.info("Fetching external market data…");
  const rawMarketData = await fetchAllMarketData();
  const marketBrief = await runMarketAnalyst(
    config.anthropicApiKey,
    rawMarketData.market,
    rawMarketData.fearGreed,
    rawMarketData.onChainVolume,
  );

  // --- Phase 2: record the reference cirBTC price and build a persisted series ---
  // Prefer Circle's on-chain cirBTC rate. When that feed is down — as it is during
  // the Arc cirBTC liquidity outage — fall back to the real BTC spot price from
  // CoinGecko: cirBTC is tokenized BTC, so spot is the honest reference used to
  // size the simulated (paper) fills. Every snapshot records its `source`, so the
  // provenance stays fully auditable.
  let cirBtcPriceSnapshots = await readPrices();
  {
    let priceUsd: number | null = null;
    let source = "";
    if (config.kitKey) {
      const realPrice = await fetchCirBtcPriceUsd(config.kitKey);
      if (realPrice) { priceUsd = realPrice.priceUsd; source = "circle_swapkit"; }
    }
    if (priceUsd == null && rawMarketData.market && rawMarketData.market.btcPriceUsd > 0) {
      priceUsd = rawMarketData.market.btcPriceUsd;
      source = "coingecko_btc_spot";
    }
    if (priceUsd != null) {
      const snapshot = { date, timestamp, priceUsd, source };
      try {
        await appendPrice(snapshot);
        cirBtcPriceSnapshots = [...cirBtcPriceSnapshots, snapshot];
        logger.info(`Recorded cirBTC reference price: $${priceUsd.toFixed(2)} (${source})`);
      } catch (err) {
        logger.error("Failed to persist cirBTC price (non-fatal)", err);
      }
    }
  }

  const minSwapUsdc = Number.parseFloat(config.guardrails.minSwapUsdc);

  // --- Non-custodial allowance mode (gated by ALLOWANCE_MODE) ---
  // Instead of spending a pooled deposit, pull each user's scheduled amount from
  // their own wallet via transferFrom, swap the sum, and send cirBTC back.
  if (config.allowanceMode) {
    // Never pull real USDC for a token whose swap route is offline: the swap
    // could only fail and the pulled USDC would be stranded in the agent wallet
    // (#5). Skip the run entirely instead — nothing is pulled, nothing is stuck.
    if (dcaTokenInfo(config.tokenOut).simulated) {
      return writeAndReturn({
        date, timestamp, status: "skipped_guardrail_clamped",
        requestedAmountUsdc: "0.000000", clampedAmountUsdc: "0", boundBy: "route_offline",
        tokenOut: config.tokenOut, walletUsdcBalance: usdcBalance,
        message: `Allowance mode paused: ${config.tokenOut} has no live swap route on Arc Testnet — not pulling real USDC (it would only get stuck).`,
      }, false, config.discordWebhookUrl, refCtx);
    }

    const { spends, totalUsdc } = await computeAllowanceSpends(ledger, ARC_TESTNET_RPC, ARC_USDC_CONTRACT, wallet.address, timestamp);
    logger.info(`Allowance mode: ${spends.length} active user(s), total pull ${totalUsdc} USDC`);

    if (totalUsdc < minSwapUsdc) {
      return writeAndReturn({
        date, timestamp, status: "skipped_guardrail_clamped",
        requestedAmountUsdc: totalUsdc.toFixed(6), clampedAmountUsdc: "0", boundBy: "allowance_below_min",
        tokenOut: config.tokenOut, walletUsdcBalance: usdcBalance,
        message: `Allowance mode: ${spends.length} user(s), total ${totalUsdc.toFixed(6)} < min swap ${minSwapUsdc}`,
      }, false, config.discordWebhookUrl, refCtx);
    }

    if (config.dryRun) {
      return writeAndReturn({
        date, timestamp, status: "dry_run",
        requestedAmountUsdc: totalUsdc.toFixed(6), clampedAmountUsdc: totalUsdc.toFixed(6),
        tokenOut: config.tokenOut, walletUsdcBalance: usdcBalance,
        message: `[DRY RUN] Allowance mode would pull ${totalUsdc.toFixed(6)} USDC from ${spends.length} wallet(s) → swap → send cirBTC back`,
      }, false, config.discordWebhookUrl, refCtx);
    }

    // LIVE: pull each user's amount via transferFrom.
    const pulled: Array<{ user: string; amount: number }> = [];
    for (const s of spends) {
      try {
        await pullUsdcFromUser({
          apiKey: config.circleApiKey, entitySecret: config.circleEntitySecret, walletId: config.walletId,
          usdcContract: ARC_USDC_CONTRACT, agentAddress: wallet.address, user: s.user, amountUsdc: s.amount.toFixed(6),
        });
        pulled.push({ user: s.user, amount: s.amount });
      } catch (err) {
        logger.error(`transferFrom pull failed for ${s.user} (non-fatal)`, err);
      }
    }
    const pulledTotal = pulled.reduce((a, x) => a + x.amount, 0);
    if (pulledTotal < minSwapUsdc) {
      // The USDC is already in the agent wallet but there's too little to swap —
      // return every pulled amount so nothing is stranded (#5).
      const refund = await refundPulledUsdc(config, pulled);
      return writeAndReturn({
        date, timestamp, status: "error_swap_failed", tokenOut: config.tokenOut, walletUsdcBalance: usdcBalance,
        message: `Allowance mode: pulled only ${pulledTotal.toFixed(6)} USDC (< min swap ${minSwapUsdc}); refunded ${refund.refunded.toFixed(6)} USDC${refund.failed ? `, ${refund.failed} refund(s) FAILED — manual return needed` : ""}`,
      }, false, config.discordWebhookUrl, refCtx);
    }

    try {
      const swapResult = await executeSwap({
        circleApiKey: config.circleApiKey, circleEntitySecret: config.circleEntitySecret,
        walletAddress: wallet.address, kitKey: config.kitKey, tokenOut: config.tokenOut,
        amountUsdc: pulledTotal.toFixed(6), dryRun: false,
      });
      let sentBack = 0;
      const sendBackFailures: string[] = [];
      if (swapResult.amountOut) {
        const totalOut = Number.parseFloat(swapResult.amountOut);
        for (const p of pulled) {
          const share = ((p.amount / pulledTotal) * totalOut).toFixed(8);
          try {
            // sendTokenToUser now waits for on-chain confirmation and throws if
            // the send-back reverts — so the ledger is credited ONLY after the
            // cirBTC has actually reached the user's wallet, never on a failed or
            // unconfirmed send.
            await sendTokenToUser({
              apiKey: config.circleApiKey, entitySecret: config.circleEntitySecret, walletId: config.walletId,
              tokenContract: ARC_CIRBTC_CONTRACT, user: p.user, amount: share,
            });
            const u = ledger.users[p.user.toLowerCase()];
            if (u) {
              u.cirBtcBalance = (Number.parseFloat(u.cirBtcBalance) + Number.parseFloat(share)).toFixed(8);
              u.totalSwapped = (Number.parseFloat(u.totalSwapped) + p.amount).toFixed(6);
              u.lastChargedAt = timestamp;
              u.lastActivity = timestamp;
            }
            sentBack += 1;
          } catch (err) {
            // The USDC was already swapped to cirBTC held by the agent, so we
            // can't cleanly refund USDC here. Leave the ledger uncredited AND
            // lastChargedAt unchanged so this user isn't double-counted, and
            // surface the owed cirBTC loudly for manual reconciliation (#5).
            sendBackFailures.push(`${p.user} (owed ${share} cirBTC)`);
            logger.error(`cirBTC send-back failed for ${p.user} — ${share} cirBTC owed, held in agent wallet, needs manual send; ledger not credited`, err);
          }
        }
        await saveLedger(ledger);
      }
      const owedNote = sendBackFailures.length
        ? `; ${sendBackFailures.length} send-back(s) FAILED — owed cirBTC held in agent wallet: ${sendBackFailures.join(", ")}`
        : "";
      return writeAndReturn({
        date, timestamp, status: "success",
        requestedAmountUsdc: totalUsdc.toFixed(6), clampedAmountUsdc: pulledTotal.toFixed(6),
        tokenOut: config.tokenOut, txHash: swapResult.txHash, explorerUrl: swapResult.explorerUrl, amountOut: swapResult.amountOut,
        walletUsdcBalance: usdcBalance,
        reasoning: `Allowance mode: pulled ${pulledTotal.toFixed(6)} USDC from ${pulled.length} wallet(s), swapped, sent cirBTC back to ${sentBack}.`,
        message: `Allowance DCA: pulled + swapped ${pulledTotal.toFixed(6)} USDC across ${pulled.length} user(s), cirBTC delivered to ${sentBack}/${pulled.length}${owedNote}`,
      }, false, config.discordWebhookUrl, refCtx);
    } catch (err) {
      const category = err instanceof SwapExecutionError ? err.category : "unknown";
      logger.error(`Allowance swap failed [${category}]`, err);
      // The swap never settled, so the pulled USDC is still USDC in the agent
      // wallet — send it all back rather than stranding it (#5).
      const refund = await refundPulledUsdc(config, pulled);
      return writeAndReturn({
        date, timestamp, status: "error_swap_failed", clampedAmountUsdc: pulledTotal.toFixed(6),
        tokenOut: config.tokenOut, walletUsdcBalance: usdcBalance,
        message: `Allowance swap failed [${category}]: ${(err as Error).message}; refunded ${refund.refunded.toFixed(6)} USDC${refund.failed ? `, ${refund.failed} refund(s) FAILED — manual return needed` : ""}`,
      }, false, config.discordWebhookUrl, refCtx);
    }
  }

  // NB: the wallet reserve / balance is NOT a whole-run gate. It only bounds the
  // LIVE (real-swap) portion of the schedule, applied via clampDecision on
  // `liveTotal` below. Gating the whole run here would wrongly halt simulated
  // (paper) fills, which spend no real USDC (#2).

  // --- Cách B: deterministic per-user schedule-driven sizing ---
  // The buy amount is the SUM of each active user's scheduled spend; the agent
  // no longer sizes the buy. Smart-mode users are additionally gated on live
  // market context (cirBTC drawdown from recent high + Fear & Greed).
  const recentPrices = cirBtcPriceSnapshots.slice(-30).map((s) => s.priceUsd).filter((p) => p > 0);
  const priceHigh = recentPrices.length ? Math.max(...recentPrices) : 0;
  const priceNow = recentPrices.length ? recentPrices[recentPrices.length - 1]! : 0;
  const drawdownPct = priceHigh > 0 && priceNow > 0 ? Math.max(0, (priceHigh - priceNow) / priceHigh) : 0;

  // Agent-chosen sizing (bounded). The agent reads the brief + its own reflections
  // and proposes a market-wide size multiplier; code re-clamps it per-user and to
  // hard caps. On any failure this is null and smart sizing falls back to the
  // deterministic dip+F&G formula — the agent gets bounded agency, never control.
  const sizingProposal = await proposeSmartMultiplier(config.anthropicApiKey, {
    brief: marketBrief,
    drawdownPct,
    recentReflections: reflections.slice(-3).map((r) => r.insight).filter(Boolean),
  });

  const schedule = computeScheduledSpends(ledger, timestamp, {
    drawdownPct,
    fearGreedIndex: marketBrief?.fearGreedIndex ?? null,
    sizeDeviation: sizingProposal?.deviation,
  });
  const scheduledTotal = schedule.totalUsdc;
  const minSwap = Number.parseFloat(config.guardrails.minSwapUsdc);
  // clampDecision (below) is the sole authority on the LIVE (real-swap) number
  // actually spent: it re-derives the real cap from every hard guardrail —
  // max/day, wallet reserve, remaining daily cap, campaign budget, dust floor. The
  // user schedule is only the *request*; the code owns the number. (The per-user
  // daily/weekly caps were already applied inside computeScheduledSpends; this is
  // the global ceiling.) Simulated (paper) spend settles outside this clamp — it
  // moves no real USDC — bounded only by the per-user caps already applied.
  // Nothing due this run is an ordinary outcome, not a decision — short-circuit
  // so the audit trail says so plainly instead of borrowing clampDecision's
  // "llm_declined" skip reason, which would be flatly untrue here.
  if (scheduledTotal <= 0) {
    // The hourly cron fires even when nobody's schedule is due. Recording a no-op
    // heartbeat every such tick bloated history.json and buried the real runs, so we
    // return the outcome WITHOUT persisting, notifying, or reflecting — no idle entry
    // is written. (Real runs — success/error/guardrail — are still recorded below.)
    logger.info("No user was due this run; skipping (not recording a no-op heartbeat)");
    return {
      entry: {
        date,
        timestamp,
        status: "skipped_guardrail_clamped",
        requestedAmountUsdc: "0.000000",
        clampedAmountUsdc: "0",
        boundBy: "no_scheduled_spend",
        tokenOut: config.tokenOut,
        walletUsdcBalance: usdcBalance,
        message: `No buy this run: no user was due (0 scheduled USDC across ${Object.keys(ledger.users).length} account(s))`,
      },
      isFatal: false,
    };
  }

  // --- x402: the agent pays (a metered USDC micro-payment) for its brief input ---
  // Placed AFTER the "nobody due" short-circuit so the agent only pays for a brief
  // on runs where it actually makes a DCA decision — the receipt then rides this
  // run's recorded entries into history.json (and the Telegram alert), and no USDC
  // is spent (nor history bloated) on idle heartbeat ticks. Gated + best-effort:
  // inert unless X402_ENABLED, never throws, never touches DCA money/state.
  const x402Receipt = await payForMarketBriefBestEffort();

  // Split the scheduled spend into SIMULATED (paper — no real USDC leaves the
  // wallet) and LIVE (a real USDC→token swap). Only the live portion may be bound
  // by the wallet balance / reserve / daily-cap guardrails; paper fills touch no
  // real funds, so gating them on the wallet would wrongly halt (#2) or throttle
  // (#1) them. Per-user daily/weekly caps were already applied to BOTH inside
  // computeScheduledSpends. A token counts as simulated for this run only when it
  // has no live route AND we have a price to fill against — otherwise it falls
  // through to a real swap (see the group loop) and must be clamped as live.
  const isSimNow = (token: string) => dcaTokenInfo(token).simulated === true && priceNow > 0;
  const { liveTotal, simTotal } = splitScheduledBySettlement(schedule.spends, isSimNow);

  // Auto-scale the global daily ceiling with the active user base. The effective
  // cap is the smaller of the operator's absolute circuit-breaker
  // (env MAX_DAILY_USDC) and the sum of every active user's own daily cap. Since
  // each user is already bounded by their per-user cap, that sum is the largest
  // total that can legitimately be spent in a day — so as the crowd grows the
  // ceiling rises with it and nobody is diluted pro-rata by a static number,
  // while the env value still hard-caps runaway spend. (0 = no per-user caps set
  // → fall back to the raw env ceiling.)
  const envMaxDaily = Number.parseFloat(config.guardrails.maxDailyUsdc);
  const budgetTotal = activeDailyBudgetTotal(ledger);
  const effectiveMaxDaily = budgetTotal > 0 ? Math.min(envMaxDaily, budgetTotal) : envMaxDaily;
  if (budgetTotal > 0 && effectiveMaxDaily !== envMaxDaily) {
    logger.info(`Daily ceiling auto-scaled to ${effectiveMaxDaily} USDC (Σ active per-user caps) under env cap ${envMaxDaily}`);
  }

  // clampDecision owns the real number swapped — but only for the LIVE portion.
  // When there is no live spend this run (all paper), it is not consulted.
  const clamp: ClampedDecision = liveTotal > 0
    ? clampDecision(
        { proceed: true, amountUsdc: liveTotal.toFixed(6), reasoning: "per-user live schedule sum" },
        {
          guardrails: { ...config.guardrails, maxDailyUsdc: effectiveMaxDaily.toFixed(6) },
          walletUsdcBalance: usdcBalance,
          alreadySpentTodayUsdc: alreadySpentToday(history, date),
          remainingCampaignBudgetUsdc: remainingCampaignBudget(history, config.guardrails.campaignTotalBudgetUsdc),
        },
      )
    : { proceed: false, amountUsdc: "0", boundBy: "no_live_spend" };
  const liveExecutable = clamp.proceed ? Number.parseFloat(clamp.amountUsdc) : 0;
  // Per-group scale for LIVE groups only; simulated groups always settle at 1.0.
  const liveScale = liveTotal > 0 && liveExecutable > 0 ? liveExecutable / liveTotal : 0;

  // Skip the whole run only when the live portion is dust/blocked AND there is no
  // paper work either. When paper fills are due, fall through: they settle
  // regardless of the wallet, and any dust/blocked live group emits its own
  // per-group skip in the loop below.
  if (liveExecutable < minSwap && simTotal <= 0) {
    const insufficient = clamp.boundBy === "wallet_available_after_reserve";
    logger.info(`Live spend ${liveTotal} USDC clamped to ${liveExecutable} by ${clamp.boundBy}; skipping`);
    return writeAndReturn({
      date,
      timestamp,
      status: insufficient ? "skipped_insufficient_balance" : "skipped_guardrail_clamped",
      requestedAmountUsdc: liveTotal.toFixed(6),
      clampedAmountUsdc: "0",
      boundBy: clamp.boundBy,
      tokenOut: config.tokenOut,
      walletUsdcBalance: usdcBalance,
      message: insufficient
        ? `No buy this run: wallet ${usdcBalance} USDC at/below reserve — live spend ${liveTotal.toFixed(6)} USDC not affordable`
        : `No buy this run: ${schedule.spends.length} active user(s), live scheduled ${liveTotal.toFixed(6)} USDC, clamped to ${liveExecutable.toFixed(6)} by ${clamp.boundBy} (min swap ${minSwap})`,
    }, false, config.discordWebhookUrl, refCtx);
  }

  // Advisory market commentary (non-fatal). Sizing is deterministic; the agent's
  // reasoning is kept only to enrich the dashboard's AI insights + reflections.
  let reasoning = `Rate-based DCA: ${schedule.spends.length} active user(s), executing ~${(liveExecutable + simTotal).toFixed(6)} USDC this run (${liveExecutable.toFixed(6)} live + ${simTotal.toFixed(6)} paper).`;
  try {
    const outage = outageStreak(history);
    const context: DecisionContext = {
      date,
      dayCount: dayCount(history, date),
      walletUsdcBalance: usdcBalance,
      guardrails: config.guardrails,
      dcaStrategy: config.dcaStrategy,
      remainingCampaignBudgetUsdc: remainingCampaignBudget(history, config.guardrails.campaignTotalBudgetUsdc),
      alreadySpentTodayUsdc: alreadySpentToday(history, date),
      outageConsecutiveRuns: outage.consecutiveRuns,
      outageDurationDays: outage.days,
      recentHistory: recentHistory(history).map((e) => ({
        date: e.date,
        status: e.status,
        amountUsdc: e.clampedAmountUsdc,
        reasoningSummary: e.reasoning,
      })),
    };
    const commentary = await getClaudeDecision(config.anthropicApiKey, context, {
      history,
      reflections,
      walletUsdcBalance: usdcBalance,
      alreadySpentTodayUsdc: context.alreadySpentTodayUsdc,
      remainingCampaignBudgetUsdc: context.remainingCampaignBudgetUsdc,
      dcaStrategy: config.dcaStrategy,
      marketBrief,
      cirBtcPriceSnapshots,
    });
    if (commentary?.reasoning) reasoning = commentary.reasoning;
  } catch (err) {
    logger.warn(`Advisory commentary failed (non-fatal): ${(err as Error).message}`);
  }

  // --- Multi-token settlement: one pooled swap per token group ---
  // Each user DCAs into their chosen token (default config.tokenOut). Group the
  // run by token, size each group by its share of the executable total, and
  // settle ONE USDC -> token swap per group. A failed or sub-minimum group never
  // blocks the others. LIVE groups carry the wallet clamp via `liveScale`;
  // SIMULATED groups touch no real USDC so they always settle at their full
  // per-user-capped schedule (scale 1) — the wallet can neither halt nor throttle
  // a paper fill (#1/#2). Per-group scale/boundBy are computed in the loop.
  const groups = groupSpendsByToken(schedule.spends);
  const tokens = [...groups.keys()].sort(); // deterministic settlement order
  const entries: HistoryEntry[] = [];

  // The market snapshot that drove smart-mode sizing this run, and the base
  // (sensitivity 1) multiplier it produced — recorded on any group that had a
  // smart participant, as the on-chain audit of the agent's dynamic sizing.
  const smartFg = marketBrief?.fearGreedIndex ?? null;
  // The base (sensitivity-1) multiplier this run: the agent's clamped choice when
  // it made one, else the deterministic formula. Recorded per smart group for the
  // on-chain audit + the 🧠 badge.
  const smartBaseMult = sizingProposal
    ? sizingProposal.multiplier
    : smartSizeMultiplier({ drawdownPct, fearGreedIndex: smartFg });
  const smartSource: "llm" | "formula" = sizingProposal ? "llm" : "formula";

  for (const token of tokens) {
    const info = dcaTokenInfo(token);
    const groupSpends = groups.get(token)!;
    const users = groupSpends.length;
    const groupScheduled = groupSpends.reduce((s, x) => s + x.spend, 0);
    // Simulated groups settle in full (paper, no real USDC); live groups carry
    // the wallet clamp via liveScale.
    const sim = info.simulated === true && priceNow > 0;
    const groupScale = sim ? 1 : liveScale;
    const groupExec = Number.parseFloat((groupScheduled * groupScale).toFixed(6));
    // When a LIVE group was clamped (groupScale < 1), report the guardrail that
    // ACTUALLY bound it — clampDecision already picked the real binding (daily
    // cap, wallet reserve, campaign budget, …). Hard-coding "wallet_available_
    // after_reserve" here mislabels e.g. a daily-cap clamp, which is dishonest in
    // an audit trail whose whole point is that the number is trustworthy. Paper
    // groups are never wallet-clamped, so they always report "user_schedule".
    const boundBy = !sim && groupScale < 1 ? clamp.boundBy : "user_schedule";

    if (groupExec < minSwap) {
      entries.push({
        date, timestamp, status: "skipped_guardrail_clamped",
        requestedAmountUsdc: groupScheduled.toFixed(6), clampedAmountUsdc: "0",
        boundBy: "group_below_min_swap", tokenOut: token, reasoning,
        walletUsdcBalance: usdcBalance,
        message: `No buy for ${token}: ${users} user(s), executable ${groupExec.toFixed(6)} USDC < min swap ${minSwap}`,
      });
      continue;
    }

    const groupExecStr = groupExec.toFixed(6);
    const smartSizing = groupSpends.some((s) => s.sizeMultiplier != null)
      ? { fearGreed: smartFg, drawdownPct, multiplier: smartBaseMult, source: smartSource, proposedMultiplier: sizingProposal?.rawMultiplier ?? null }
      : undefined;

    // --- Simulated (paper) settlement for a token with no live Arc route ---
    // cirBTC's liquidity is out on Arc Testnet, so a real swap can only fail.
    // Record an honest paper fill at the live market price (priceNow, already
    // fetched + persisted this run) instead: no on-chain tx, real USDC untouched,
    // tracked in the separate sim* ledger fields and clearly labelled everywhere.
    // If we couldn't price it, fall through to the real swap so the outage is
    // still recorded honestly as a no-route failure.
    if (sim) {
      // Dry run reports the paper fill without persisting it, mirroring the real
      // swap path (which also no-ops the ledger under dryRun).
      if (config.dryRun) {
        const received = Number.parseFloat((groupExec / priceNow).toFixed(info.decimals));
        entries.push({
          date, timestamp, status: "dry_run", simulated: true,
          requestedAmountUsdc: groupScheduled.toFixed(6), clampedAmountUsdc: groupExecStr,
          boundBy, tokenOut: token, reasoning, amountOut: received.toFixed(info.decimals), priceUsd: priceNow,
          walletUsdcBalance: usdcBalance,
          message: `[DRY RUN][SIMULATED] Would paper-fill ${received.toFixed(info.decimals)} ${token} for ${groupExecStr} USDC at $${priceNow.toFixed(2)}/${token}`,
          ...(smartSizing ? { smartSizing } : {}),
        });
        continue;
      }
      const sim = applySimulatedDistribution(ledger, groupSpends, groupExecStr, priceNow, timestamp, token, info.decimals);
      const received = sim ? sim.received : 0;
      entries.push({
        date, timestamp, status: "simulated", simulated: true,
        requestedAmountUsdc: groupScheduled.toFixed(6), clampedAmountUsdc: groupExecStr,
        boundBy, tokenOut: token, reasoning,
        amountOut: received.toFixed(info.decimals), priceUsd: priceNow,
        walletUsdcBalance: usdcBalance,
        message: `[SIMULATED] Arc ${token} route offline — paper-filled ${received.toFixed(info.decimals)} ${token} for ${groupExecStr} USDC at $${priceNow.toFixed(2)}/${token} (no on-chain swap; real funds untouched)`,
        ...(smartSizing ? { smartSizing } : {}),
      });
      continue;
    }

    try {
      const swapResult = await executeSwap({
        circleApiKey: config.circleApiKey,
        circleEntitySecret: config.circleEntitySecret,
        walletAddress: wallet.address,
        kitKey: config.kitKey,
        tokenOut: token,
        amountUsdc: groupExecStr,
        dryRun: config.dryRun,
      });
      logger.info(swapResult.dryRun ? `Dry run: ${token} swap skipped` : `Swap executed [${token}]: ${swapResult.txHash}`);
      if (!swapResult.dryRun && swapResult.amountOut) {
        applyScheduledDistribution(ledger, groupSpends, groupExecStr, swapResult.amountOut, timestamp, token, info.decimals);
      }
      entries.push({
        date, timestamp,
        status: swapResult.dryRun ? "dry_run" : "success",
        requestedAmountUsdc: groupScheduled.toFixed(6), clampedAmountUsdc: groupExecStr,
        boundBy, tokenOut: token, reasoning,
        txHash: swapResult.txHash, explorerUrl: swapResult.explorerUrl, amountOut: swapResult.amountOut,
        walletUsdcBalance: usdcBalance,
        message: swapResult.dryRun
          ? `[DRY RUN] Would swap ${groupExecStr} USDC -> ${token} across ${users} user(s)`
          : `Swapped ${groupExecStr} USDC -> ${token} across ${users} user(s)`,
        ...(smartSizing ? { smartSizing } : {}),
      });
    } catch (err) {
      const category = err instanceof SwapExecutionError ? err.category : "unknown";
      logger.error(`Swap execution failed [${token}/${category}]`, err);
      entries.push({
        date, timestamp, status: "error_swap_failed",
        requestedAmountUsdc: groupScheduled.toFixed(6), clampedAmountUsdc: groupExecStr,
        boundBy, tokenOut: token, reasoning,
        walletUsdcBalance: usdcBalance,
        message: `Swap failed [${token}/${category}]: ${(err as Error).message}`,
        ...(smartSizing ? { smartSizing } : {}),
      });
    }
  }

  await saveLedger(ledger);
  if (x402Receipt) for (const e of entries) e.x402 = x402Receipt;
  return emitRunEntries(entries, config.discordWebhookUrl, refCtx);
}
