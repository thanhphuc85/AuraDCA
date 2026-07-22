import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";

// Conversational assistant for the Aura DCA dashboard. Claude answers questions
// using read-only tools (treasury, account, trade history, market read, agent
// memory, on-chain audit) that execute here on the server. Sensitive actions
// (change DCA schedule, run a DCA now) are NEVER executed here — Claude only
// *proposes* them, and the frontend renders a Confirm button + wallet signature
// so the user authorizes each one explicitly.

const MODEL = "claude-sonnet-5";
const MAX_TURNS = 6;
const MAX_MESSAGES = 24;
const MAX_MSG_CHARS = 4000;

const SUPPORTED_TOKENS = ["cirBTC", "EURC"] as const;
const ATTESTATION_CONTRACT = "0x4948c662630c7dE36BD59089085850c00996F661";
const ARC_EXPLORER = "https://testnet.arcscan.app";

const LEDGER_SOURCES = [
  "https://cdn.jsdelivr.net/gh/thanhphuc85/AuraDCA@main/data/ledger.json",
  "https://raw.githubusercontent.com/thanhphuc85/AuraDCA/main/data/ledger.json",
];
const HISTORY_SOURCES = [
  "https://cdn.jsdelivr.net/gh/thanhphuc85/AuraDCA@main/data/history.json",
  "https://raw.githubusercontent.com/thanhphuc85/AuraDCA/main/data/history.json",
];
const REFLECTION_SOURCES = [
  "https://cdn.jsdelivr.net/gh/thanhphuc85/AuraDCA@main/data/reflections.json",
  "https://raw.githubusercontent.com/thanhphuc85/AuraDCA/main/data/reflections.json",
];

interface LedgerUser {
  address: string;
  usdcBalance?: string;
  cirBtcBalance?: string;
  tokenBalances?: Record<string, string>;
  totalDeposited?: string;
  totalSwapped?: string;
  dcaRatePerDay?: string;
  dcaPaused?: boolean;
  dcaMode?: "auto" | "manual" | "smart";
  dcaTokenOut?: string;
  dcaFrequency?: "daily" | "hours" | "days" | "weekly";
  dcaEveryHours?: number;
  dcaEveryDays?: number;
  dcaWeekdays?: number[];
  dcaAmountPerRun?: string;
  dcaDailyCapUsdc?: string;
  dcaWeeklyCapUsdc?: string;
  dcaSmartMinDipPct?: number;
  dcaSmartFearBelow?: number;
  dcaSmartSensitivity?: number;
  dcaSmartMaxMult?: number;
  [k: string]: unknown;
}
interface Ledger { users?: Record<string, LedgerUser>; [k: string]: unknown; }
interface HistoryEntry {
  date?: string;
  status?: string;
  requestedAmountUsdc?: string;
  clampedAmountUsdc?: string;
  amountOut?: string;
  tokenOut?: string;
  boundBy?: string;
  reasoning?: string;
  message?: string;
  txHash?: string;
  smartSizing?: { fearGreed?: number | null; drawdownPct?: number; multiplier?: number; source?: string; proposedMultiplier?: number | null };
  [k: string]: unknown;
}
interface Reflection {
  date?: string;
  insight?: string;
  patterns?: string[];
  strategyAdjustment?: string;
  confidenceLevel?: string;
  [k: string]: unknown;
}

async function fetchJson<T>(sources: string[]): Promise<T | null> {
  for (const url of sources) {
    try {
      const r = await fetch(url, { cache: "no-store" } as RequestInit);
      if (!r.ok) continue;
      return (await r.json()) as T;
    } catch { /* try next */ }
  }
  return null;
}

function num(v: unknown): number { const n = parseFloat(String(v ?? "0")); return Number.isFinite(n) ? n : 0; }

// Best-effort in-memory rate limit. Serverless instances aren't shared, so this
// only throttles within a warm instance — enough to blunt a naive flood of
// unauthenticated calls (each one hits Claude, up to MAX_TURNS times, and costs
// real credits). Not a security boundary.
const _rlHits = new Map<string, number[]>();
function rateLimited(req: VercelRequest, limit: number, windowMs: number): boolean {
  const xff = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const recent = (_rlHits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) { _rlHits.set(ip, recent); return true; }
  recent.push(now); _rlHits.set(ip, recent);
  if (_rlHits.size > 5000) { for (const [k, v] of _rlHits) { if (v.every((t) => now - t >= windowMs)) _rlHits.delete(k); } }
  return false;
}

// ---------- read-only tool implementations ----------
async function getTreasuryOverview(): Promise<string> {
  const ledger = await fetchJson<Ledger>(LEDGER_SOURCES);
  const users = ledger?.users ? Object.values(ledger.users) : [];
  let pooledUsdc = 0, activeDca = 0;
  const pooledTokens: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  const byToken: Record<string, number> = {};
  for (const u of users) {
    pooledUsdc += num(u.usdcBalance);
    pooledTokens["cirBTC"] = (pooledTokens["cirBTC"] ?? 0) + num(u.cirBtcBalance);
    if (u.tokenBalances) {
      for (const [sym, amt] of Object.entries(u.tokenBalances)) {
        if (sym === "cirBTC") continue; // already counted via cirBtcBalance
        pooledTokens[sym] = (pooledTokens[sym] ?? 0) + num(amt);
      }
    }
    const active = !u.dcaPaused && u.dcaMode !== "manual" && (num(u.dcaAmountPerRun) > 0 || num(u.dcaRatePerDay) > 0);
    if (active) {
      activeDca += 1;
      byMode[u.dcaMode ?? "auto"] = (byMode[u.dcaMode ?? "auto"] ?? 0) + 1;
      const tk = u.dcaTokenOut || "cirBTC";
      byToken[tk] = (byToken[tk] ?? 0) + 1;
    }
  }
  const pooled: Record<string, string> = { USDC: pooledUsdc.toFixed(6) };
  for (const [sym, amt] of Object.entries(pooledTokens)) pooled[sym] = amt.toFixed(8);
  return JSON.stringify({
    totalUsers: users.length,
    activeDcaUsers: activeDca,
    activeByMode: byMode,
    activeByTargetToken: byToken,
    pooledBalances: pooled,
    supportedDcaTokens: SUPPORTED_TOKENS,
    network: "Arc Testnet",
    note: "Balances are pooled across all users. These are testnet assets with no real value. Users DCA into a token of their choice (cirBTC or EURC today); each run pools buys per token and settles one swap per token group.",
  }, null, 2);
}

async function getMyAccount(address?: string): Promise<string> {
  if (!address) return JSON.stringify({ error: "No wallet connected. Ask the user to connect their wallet to see their own account." });
  const ledger = await fetchJson<Ledger>(LEDGER_SOURCES);
  const key = address.toLowerCase();
  const u = ledger?.users?.[key];
  if (!u) {
    return JSON.stringify({ address: key, exists: false, note: "This wallet has no account yet — it appears after the first DCA-schedule set." });
  }
  const tokenBalances: Record<string, string> = { cirBTC: num(u.cirBtcBalance).toFixed(8) };
  if (u.tokenBalances) for (const [sym, amt] of Object.entries(u.tokenBalances)) tokenBalances[sym] = num(amt).toFixed(8);
  return JSON.stringify({
    address: key,
    usdcBalance: num(u.usdcBalance).toFixed(6),
    tokenBalances,
    dcaMode: u.dcaMode ?? "auto",
    dcaTokenOut: u.dcaTokenOut || "cirBTC",
    dcaPaused: !!u.dcaPaused,
    schedule: {
      frequency: u.dcaFrequency ?? "(legacy rate/day)",
      everyHours: u.dcaEveryHours,
      everyDays: u.dcaEveryDays,
      weekdays: u.dcaWeekdays,
      amountPerRun: u.dcaAmountPerRun ?? u.dcaRatePerDay,
      dailyCapUsdc: u.dcaDailyCapUsdc,
      weeklyCapUsdc: u.dcaWeeklyCapUsdc,
    },
    smartSettings: u.dcaMode === "smart" ? {
      onlyBuyIfDipPct: u.dcaSmartMinDipPct,
      onlyBuyIfFearBelow: u.dcaSmartFearBelow,
      sizingSensitivity: u.dcaSmartSensitivity ?? 1,
      sizingMaxMultiplier: u.dcaSmartMaxMult ?? 3,
    } : null,
    dcaRatePerDay: num(u.dcaRatePerDay).toFixed(6),
    totalSwapped: num(u.totalSwapped).toFixed(6),
    totalDeposited: num(u.totalDeposited).toFixed(6),
  }, null, 2);
}

async function getRecentTrades(limit: number): Promise<string> {
  const history = await fetchJson<HistoryEntry[]>(HISTORY_SOURCES);
  if (!Array.isArray(history) || !history.length) return JSON.stringify({ trades: [], note: "No runs recorded yet." });
  const n = Math.min(Math.max(1, limit || 5), 20);
  const trades = history.slice(-n).reverse().map((e) => ({
    date: e.date,
    status: e.status,
    tokenOut: e.tokenOut ?? null,
    requestedUsdc: e.requestedAmountUsdc ?? null,
    executedUsdc: e.clampedAmountUsdc ?? null,
    tokenReceived: e.amountOut ?? null,
    boundBy: e.boundBy ?? null,
    smartSizing: e.smartSizing
      ? { multiplier: e.smartSizing.multiplier, chosenBy: e.smartSizing.source ?? "formula", fearGreed: e.smartSizing.fearGreed ?? null, dipPct: e.smartSizing.drawdownPct != null ? +(e.smartSizing.drawdownPct * 100).toFixed(1) : null }
      : null,
    reasoning: e.reasoning || e.message || null,
    txHash: e.txHash ?? null,
  }));
  return JSON.stringify({ trades }, null, 2);
}

async function getMarketRead(): Promise<string> {
  const history = await fetchJson<HistoryEntry[]>(HISTORY_SOURCES);
  if (!Array.isArray(history) || !history.length) return JSON.stringify({ note: "No runs recorded yet, so no market read." });
  const latest = history[history.length - 1];
  const lastSmart = [...history].reverse().find((e) => e.smartSizing && e.smartSizing.multiplier != null);
  // trailing cirBTC swap-failure streak = the outage the agent reasons around
  let outage = 0;
  for (let i = history.length - 1; i >= 0; i--) { if (history[i]?.status === "error_swap_failed") outage++; else break; }
  return JSON.stringify({
    latestRun: latest ? { date: latest.date, status: latest.status, tokenOut: latest.tokenOut ?? null, boundBy: latest.boundBy ?? null, reasoning: latest.reasoning || latest.message || null } : null,
    latestSmartSizing: lastSmart?.smartSizing
      ? {
          date: lastSmart.date,
          multiplier: lastSmart.smartSizing.multiplier,
          chosenBy: lastSmart.smartSizing.source ?? "formula",
          proposedBeforeClamp: lastSmart.smartSizing.proposedMultiplier ?? null,
          fearGreed: lastSmart.smartSizing.fearGreed ?? null,
          dipPct: lastSmart.smartSizing.drawdownPct != null ? +(lastSmart.smartSizing.drawdownPct * 100).toFixed(1) : null,
        }
      : null,
    cirBtcSwapFailureStreak: outage,
    note: outage > 0
      ? `cirBTC's USDC route has failed the last ${outage} run(s) — a known Arc Testnet liquidity outage. The agent rides it out; users who want live settlement can DCA into EURC instead.`
      : "Smart-mode sizing scales each buy by the dip + Fear & Greed; the agent proposes the multiplier and code clamps it. 'chosenBy' says whether the agent (llm) or the deterministic formula set it.",
  }, null, 2);
}

async function getAgentMemory(limit: number): Promise<string> {
  const reflections = await fetchJson<Reflection[]>(REFLECTION_SOURCES);
  if (!Array.isArray(reflections) || !reflections.length) return JSON.stringify({ reflections: [], note: "The agent hasn't written any reflections yet." });
  const n = Math.min(Math.max(1, limit || 3), 8);
  const out = reflections.slice(-n).reverse().map((r) => ({
    date: r.date,
    insight: r.insight ?? null,
    patterns: Array.isArray(r.patterns) ? r.patterns : [],
    strategyAdjustment: r.strategyAdjustment ?? null,
    confidence: r.confidenceLevel ?? null,
  }));
  return JSON.stringify({ reflections: out, note: "These are the agent's own post-run reflections — how it has been reading its results over time." }, null, 2);
}

function getOnchainAudit(): string {
  return JSON.stringify({
    contract: ATTESTATION_CONTRACT,
    explorer: `${ARC_EXPLORER}/address/${ATTESTATION_CONTRACT}`,
    network: "Arc Testnet",
    what: "After each run the agent records keccak256(data/ledger.json) in this AuraAttestation contract, so the committed audit trail is verifiable on-chain. The contract holds no funds — it records hashes only.",
    howToVerify: "Recompute keccak256 of data/ledger.json at the run's commit and compare to the contract's latestHash, or run `npm run verify-attest` in the repo (read-only).",
  }, null, 2);
}

// ---------- tool schemas ----------
const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_treasury_overview",
    description: "Get the pooled treasury state: total users, active DCA users (broken down by mode and target token), pooled per-token balances (USDC, cirBTC, EURC…), and the supported DCA tokens. Use for questions about how much is in the treasury overall or which tokens users are DCAing into.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_my_account",
    description: "Get the connected user's own account: USDC + per-token balances, their DCA mode (auto/manual/smart), target token, full schedule (frequency, cadence, per-run amount, daily/weekly caps), and smart settings (dip/fear gates, sizing sensitivity & max multiplier). Use for 'what is my balance/rate/schedule/mode'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_recent_trades",
    description: "Get the most recent DCA runs: date, status, target token, requested vs executed USDC, token received, what bound the amount, and — for smart runs — the size multiplier and whether the agent or the formula chose it. Use to explain past trades.",
    input_schema: { type: "object", properties: { limit: { type: "number", description: "How many recent runs to return (1-20, default 5)." } } },
  },
  {
    name: "get_market_read",
    description: "Get the agent's latest market read: the most recent run's status/reasoning, the latest smart-sizing multiplier (and whether the agent or the formula chose it, plus the Fear & Greed and dip it was based on), and any current cirBTC swap-failure streak (the Arc liquidity outage). Use for 'what does the agent think of the market', 'why did it size the buy that way', or 'is the cirBTC route working'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_agent_memory",
    description: "Get the agent's recent self-reflections (insight, patterns, strategy adjustment, confidence) written after past runs. Use for 'what has the agent learned' or 'what patterns has it noticed'.",
    input_schema: { type: "object", properties: { limit: { type: "number", description: "How many recent reflections (1-8, default 3)." } } },
  },
  {
    name: "get_onchain_audit",
    description: "Get the on-chain audit anchor: the AuraAttestation contract address, explorer link, and how to verify that the committed ledger matches the hash recorded on-chain. Use for 'is this verifiable on-chain' or 'where is the audit'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_set_dca_rate",
    description: "PROPOSE changing the user's DCA setup. This does NOT apply the change — it asks the frontend to show a Confirm button the user must click and sign with their wallet. Use when the user asks to change their DCA amount, cadence, caps, target token, or mode. Only propose fields the user actually specified; omit the rest to keep their current values. `rate` (USDC per run/day, 0 = pause) is required.",
    input_schema: {
      type: "object",
      properties: {
        rate: { type: "number", description: "Amount in USDC per run (>= 0; 0 = pause). If a frequency is given this is the per-run amount." },
        mode: { type: "string", enum: ["auto", "manual", "smart"], description: "auto = agent runs on the user's schedule; manual = agent skips them in scheduled runs; smart = auto + the buy is gated on and sized by market conditions (dip & Fear & Greed). Omit to keep current." },
        tokenOut: { type: "string", enum: ["cirBTC", "EURC"], description: "Which token to DCA into. cirBTC = tokenized BTC (route currently in outage); EURC = euro stablecoin (live). Omit to keep current." },
        frequency: { type: "string", enum: ["daily", "hours", "days", "weekly"], description: "Cadence. Omit to keep current schedule." },
        everyHours: { type: "number", description: "For frequency 'hours': run every N hours (1-24)." },
        everyDays: { type: "number", description: "For frequency 'days': run every N days." },
        weekdays: { type: "array", items: { type: "number" }, description: "For frequency 'weekly': UTC weekdays, 0=Sun … 6=Sat." },
        dailyCap: { type: "number", description: "Max USDC per day (0/omit = no cap)." },
        weeklyCap: { type: "number", description: "Max USDC per week (0/omit = no cap)." },
        smartDip: { type: "number", description: "Smart gate: only buy if cirBTC drawdown-from-high ≥ this percent." },
        smartFear: { type: "number", description: "Smart gate: only buy if the Fear & Greed index is below this (0-100)." },
        smartSensitivity: { type: "number", description: "Smart sizing: how hard the market read scales the buy (0.1-5, default 1)." },
        smartMaxMult: { type: "number", description: "Smart sizing: ceiling on the size multiplier (1-5, default 3)." },
      },
      required: ["rate"],
    },
  },
  {
    name: "propose_run_dca",
    description: "PROPOSE running a DCA buy now for a given USDC amount. This does NOT execute — it asks the frontend to show a Confirm step. Use when the user asks to buy/run DCA immediately with a specific amount.",
    input_schema: { type: "object", properties: { amountUsdc: { type: "number", description: "USDC amount to spend in this immediate DCA buy (> 0)." } }, required: ["amountUsdc"] },
  },
];

const SYSTEM_PROMPT = `You are the assistant for "Aura DCA Agent", a dashboard for an autonomous agent that dollar-cost-averages USDC into a token the user chooses on Arc Testnet (a testnet — assets have no real value). Users can DCA into cirBTC (tokenized BTC; its route is currently in a liquidity outage on Arc Testnet) or EURC (euro stablecoin; live). Each run pools everyone's buys per token and settles one swap per token group through Circle's Swap Kit.

Modes: auto (runs on the user's schedule), manual (agent skips them; they buy on demand), smart (auto + the buy is gated on market conditions AND sized by them — the agent proposes a multiplier from the dip + Fear & Greed, and code clamps it within the user's sensitivity and max-multiplier). The final swap amount is always owned by code (clampDecision + caps), never by the model. After each run the agent hashes the committed ledger into an on-chain AuraAttestation contract, so the audit trail is verifiable on Arc.

Guidelines:
- Reply in the SAME language the user writes in (Vietnamese or English).
- Be concise and concrete. Use the read-only tools to ground answers in real data instead of guessing. For the treasury, a user's own balance/schedule/mode, past trades, the market read, what the agent has learned, or the on-chain audit, call the matching tool first.
- NEVER claim a sensitive action (changing the DCA setup, running a DCA now) has been done. You cannot execute those. Instead call propose_set_dca_rate / propose_run_dca; the user then confirms and signs in the UI. After proposing, tell them to click Confirm below to sign and apply it.
- When proposing a DCA change, only include the fields the user specified; omit the rest so their current values are kept. If they ask to change something WITHOUT a concrete number (e.g. "adjust my rate"), don't guess — check their current setup with get_my_account first, then ask what they want.
- If the user already has a frequency set (from get_my_account) and they change their per-run amount, include that same frequency in the proposal so the new amount actually takes effect. When switching a user to smart mode, you may set smartSensitivity/smartMaxMult if they express how aggressive they want it (higher sensitivity = bigger swings; max multiplier caps the upside).
- If the user is not connected (get_my_account returns no wallet), ask them to connect their wallet for account-specific answers.
- You are not a licensed financial advisor; do not give personalized investment advice. You may explain how the agent works and what the data shows.`;

interface SchedulePayload {
  freq?: "daily" | "hours" | "days" | "weekly";
  everyHours?: number;
  everyDays?: number;
  weekdays?: number[];
  amountPerRun?: string;
  dailyCap?: string;
  weeklyCap?: string;
  smartDip?: number;
  smartFear?: number;
  smartSensitivity?: number;
  smartMaxMult?: number;
}

type Proposal =
  | { action: "set_dca_rate"; rate: number; mode?: "auto" | "manual" | "smart"; tokenOut?: string; schedule?: SchedulePayload }
  | { action: "run_dca"; amountUsdc: number };

// Build a schedule payload from the tool input when the user specified a cadence
// or smart tuning. Values are lightly coerced; set-dca-rate.ts re-validates and
// clamps everything server-side when the signed message is posted.
function buildSchedule(input: Record<string, unknown>, rate: number): SchedulePayload | undefined {
  const freq = input.frequency;
  const hasFreq = freq === "daily" || freq === "hours" || freq === "days" || freq === "weekly";
  const smartFields = ["smartDip", "smartFear", "smartSensitivity", "smartMaxMult", "dailyCap", "weeklyCap"];
  const hasExtra = smartFields.some((k) => input[k] != null);
  if (!hasFreq && !hasExtra) return undefined;
  const s: SchedulePayload = { freq: hasFreq ? (freq as SchedulePayload["freq"]) : "daily", amountPerRun: (num(input.amountPerRun) || rate).toFixed(6) };
  if (freq === "hours") s.everyHours = Math.max(1, Math.min(24, Math.floor(num(input.everyHours) || 6)));
  if (freq === "days") s.everyDays = Math.max(1, Math.floor(num(input.everyDays) || 1));
  if (freq === "weekly" && Array.isArray(input.weekdays)) s.weekdays = (input.weekdays as unknown[]).map((d) => Math.floor(num(d))).filter((d) => d >= 0 && d <= 6);
  if (num(input.dailyCap) > 0) s.dailyCap = num(input.dailyCap).toFixed(6);
  if (num(input.weeklyCap) > 0) s.weeklyCap = num(input.weeklyCap).toFixed(6);
  if (num(input.smartDip) > 0) s.smartDip = num(input.smartDip);
  if (num(input.smartFear) > 0) s.smartFear = num(input.smartFear);
  if (num(input.smartSensitivity) > 0) s.smartSensitivity = Math.max(0.1, Math.min(5, num(input.smartSensitivity)));
  if (num(input.smartMaxMult) >= 1) s.smartMaxMult = Math.max(1, Math.min(5, num(input.smartMaxMult)));
  return s;
}

function sanitizeMessages(raw: unknown): Anthropic.MessageParam[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Anthropic.MessageParam[] = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: string }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.slice(0, MAX_MSG_CHARS);
    if (!text.trim()) continue;
    out.push({ role, content: text });
  }
  while (out.length && out[0]?.role !== "user") out.shift();
  const last = out[out.length - 1];
  if (!out.length || !last || last.role !== "user") return null;
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (rateLimited(req, 20, 60_000)) { res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) { res.status(500).json({ error: "Server misconfigured: missing ANTHROPIC_API_KEY" }); return; }

  const body = (req.body ?? {}) as { messages?: unknown; address?: string };
  const messages = sanitizeMessages(body.messages);
  if (!messages) { res.status(400).json({ error: "Invalid messages: need a non-empty list ending in a user turn" }); return; }
  const address = typeof body.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(body.address) ? body.address : undefined;

  const client = new Anthropic({ apiKey });
  let proposal: Proposal | null = null;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOLS,
      });

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) {
        const text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
        res.status(200).json({ reply: text || "…", proposal });
        return;
      }

      messages.push({ role: "assistant", content: response.content as Anthropic.MessageParam["content"] });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        let content: string;
        const input = (tu.input ?? {}) as Record<string, unknown>;
        switch (tu.name) {
          case "get_treasury_overview": content = await getTreasuryOverview(); break;
          case "get_my_account": content = await getMyAccount(address); break;
          case "get_recent_trades": content = await getRecentTrades(num(input.limit) || 5); break;
          case "get_market_read": content = await getMarketRead(); break;
          case "get_agent_memory": content = await getAgentMemory(num(input.limit) || 3); break;
          case "get_onchain_audit": content = getOnchainAudit(); break;
          case "propose_set_dca_rate": {
            const rate = num(input.rate);
            if (rate < 0) { content = JSON.stringify({ error: "Rate must be >= 0." }); break; }
            const mode = input.mode === "manual" ? "manual" : input.mode === "smart" ? "smart" : input.mode === "auto" ? "auto" : undefined;
            const tokenOut = SUPPORTED_TOKENS.includes(input.tokenOut as (typeof SUPPORTED_TOKENS)[number]) ? (input.tokenOut as string) : undefined;
            const schedule = buildSchedule(input, rate);
            proposal = { action: "set_dca_rate", rate };
            if (mode) proposal.mode = mode;
            if (tokenOut) proposal.tokenOut = tokenOut;
            if (schedule) proposal.schedule = schedule;
            content = JSON.stringify({ status: "PROPOSAL_PRESENTED", note: "A Confirm button was shown to the user with the proposed setup. Nothing changes until they click Confirm and sign. Tell them to review and confirm below." });
            break;
          }
          case "propose_run_dca": {
            const amountUsdc = num(input.amountUsdc);
            if (!(amountUsdc > 0)) { content = JSON.stringify({ error: "Amount must be > 0." }); break; }
            proposal = { action: "run_dca", amountUsdc };
            content = JSON.stringify({ status: "PROPOSAL_PRESENTED", note: "A Confirm button was shown to the user. Nothing runs until they confirm. Tell them to confirm below." });
            break;
          }
          default: content = JSON.stringify({ error: `Unknown tool: ${tu.name}` });
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content });
      }
      messages.push({ role: "user", content: results });
    }
    res.status(200).json({ reply: "I couldn't finish that request — please try rephrasing.", proposal });
  } catch (err) {
    console.error("chat handler failed:", err);
    res.status(500).json({ error: "Assistant error: " + (err instanceof Error ? err.message : String(err)) });
  }
}
