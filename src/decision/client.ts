import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { DecisionContext, ClaudeDecision } from "../types.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

export class DecisionError extends Error {
  readonly kind: "api" | "invalid_output";

  constructor(message: string, kind: "api" | "invalid_output", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DecisionError";
    this.kind = kind;
  }
}

const decisionSchema = z.object({
  proceed: z.boolean(),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, "must be a decimal string with up to 6 decimal places"),
  reasoning: z.string().min(1),
});

const DECISION_TOOL = {
  name: "record_dca_decision",
  description: "Record today's DCA decision: whether to proceed, how much USDC to spend, and why.",
  input_schema: {
    type: "object" as const,
    properties: {
      proceed: { type: "boolean" as const, description: "Whether to execute a swap today." },
      amountUsdc: { type: "string" as const, description: "Recommended USDC amount to spend, as a decimal string, e.g. '0.75'." },
      reasoning: { type: "string" as const, description: "1-3 sentence explanation for this decision." },
    },
    required: ["proceed", "amountUsdc", "reasoning"],
  },
};

const MODEL = "claude-sonnet-5";
const MAX_RETRIES = 1;

export async function getClaudeDecision(apiKey: string, context: DecisionContext): Promise<ClaudeDecision> {
  const client = new Anthropic({ apiKey });

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(context) }],
        tools: [DECISION_TOOL],
        tool_choice: { type: "tool", name: DECISION_TOOL.name },
      });

      const toolUse = response.content.find((block) => block.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw new DecisionError("Claude response did not contain a tool_use block", "invalid_output");
      }

      const parsed = decisionSchema.safeParse(toolUse.input);
      if (!parsed.success) {
        throw new DecisionError(`Claude tool output failed validation: ${parsed.error.message}`, "invalid_output");
      }

      return parsed.data;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  if (lastError instanceof DecisionError) throw lastError;
  throw new DecisionError("Claude API call failed after retries", "api", { cause: lastError });
}
