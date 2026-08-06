import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketBrief } from "../types.js";

// Mock the Anthropic SDK so proposeSmartMultiplier's network call is a pure
// function of what we make messages.create return — no real API, no key needed.
const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
    constructor(opts: { apiKey: string }) {
      // Lets a test exercise proposeSmartMultiplier's catch block synchronously,
      // with no rejected promise left dangling for the unhandled-rejection guard.
      if (opts.apiKey === "__throw__") throw Object.assign(new Error("bad request"), { status: 400 });
    }
  },
}));

// Import AFTER the mock is registered (vi.mock is hoisted, so this is safe).
const { proposeSmartMultiplier } = await import("../decision/sizing.js");

function toolUse(input: unknown) {
  return { content: [{ type: "tool_use", name: "set_size_multiplier", input }] };
}

const brief: MarketBrief = {
  sentiment: "fearful",
  confidence: 80,
  fearGreedIndex: 12,
  fearGreedLabel: "Extreme Fear",
  btcChange24h: "-6%",
  btcPrice: "$60k",
  onChainActivity: "elevated",
  keyInsights: ["capitulation wick"],
  allocationBias: "accumulate",
} as unknown as MarketBrief;

beforeEach(() => createMock.mockReset());

describe("proposeSmartMultiplier — bounded agency over buy size", () => {
  it("returns the clamped multiplier and deviation from a tool call", async () => {
    createMock.mockResolvedValue(toolUse({ multiplier: 1.8, rationale: "buying the fear" }));
    const out = await proposeSmartMultiplier("key", { brief, drawdownPct: 0.25 });
    expect(out).not.toBeNull();
    expect(out!.multiplier).toBe(1.8);
    expect(out!.rawMultiplier).toBe(1.8);
    expect(out!.deviation).toBeCloseTo(0.8, 6); // multiplier − 1, fed to per-user sizing
    expect(out!.rationale).toBe("buying the fear");
  });

  it("re-clamps an out-of-envelope proposal into [0.5, 3.0] (code owns the ceiling)", async () => {
    createMock.mockResolvedValue(toolUse({ multiplier: 9, rationale: "all in" }));
    const out = await proposeSmartMultiplier("key", { brief, drawdownPct: 0.4 });
    expect(out!.rawMultiplier).toBe(9);   // what the agent asked for
    expect(out!.multiplier).toBe(3);      // what code allowed
  });

  it("works with no brief (neutral context) and includes reflections in the prompt", async () => {
    createMock.mockResolvedValue(toolUse({ multiplier: 1, rationale: "neutral" }));
    const out = await proposeSmartMultiplier("key", {
      brief: null,
      drawdownPct: 0,
      recentReflections: ["held spend during the cirBTC outage"],
    });
    expect(out!.multiplier).toBe(1);
    // the reflection was threaded into the user prompt sent to the model
    const promptText = createMock.mock.calls[0]![0].messages[0].content as string;
    expect(promptText).toContain("held spend during the cirBTC outage");
    expect(promptText).toContain("Market brief unavailable");
  });

  it("falls back to null (deterministic formula) when the model emits no tool call", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "I decline" }] });
    expect(await proposeSmartMultiplier("key", { brief, drawdownPct: 0.1 })).toBeNull();
  });

  it("falls back to null on a non-numeric multiplier", async () => {
    createMock.mockResolvedValue(toolUse({ multiplier: "lots", rationale: "oops" }));
    expect(await proposeSmartMultiplier("key", { brief, drawdownPct: 0.1 })).toBeNull();
  });

  it("never throws when the client blows up — best-effort returns null", async () => {
    // The "__throw__" key makes the mocked SDK constructor throw, standing in for
    // any failure inside the try; proposeSmartMultiplier must swallow it → null.
    await expect(proposeSmartMultiplier("__throw__", { brief, drawdownPct: 0.1 })).resolves.toBeNull();
  });
});
