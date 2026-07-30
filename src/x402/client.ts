import type { ethers } from "ethers";
import type { PaymentRequirements, SettlementResponse } from "./types.js";
import { encodePayment, signPayment } from "./payment.js";

export interface X402FetchResult<T = unknown> {
  status: number;
  data: T;
  paid: boolean;
  requirements?: PaymentRequirements;
  settlement?: SettlementResponse;
}

/**
 * Fetch a resource that may be x402-metered: try once; on HTTP 402, read the
 * `accepts[]` requirements, sign a USDC payment authorization with `signer`, and
 * retry with the `X-PAYMENT` header. Best-effort and side-effect-free beyond the
 * signature — the caller decides what to do with the result. `fetchImpl` is
 * injectable for tests.
 */
export async function fetchWithX402<T = unknown>(
  url: string,
  signer: ethers.Signer,
  opts: { fetchImpl?: typeof fetch; init?: RequestInit; nowSec?: number } = {},
): Promise<X402FetchResult<T>> {
  const doFetch = opts.fetchImpl ?? fetch;
  const first = await doFetch(url, opts.init);
  if (first.status !== 402) {
    return { status: first.status, data: (await first.json()) as T, paid: false };
  }

  const challenge = (await first.json()) as { accepts?: PaymentRequirements[] };
  const requirements = challenge.accepts?.[0];
  if (!requirements) {
    return { status: 402, data: challenge as T, paid: false };
  }

  const payment = await signPayment(signer, requirements, { nowSec: opts.nowSec });
  const headers = new Headers(opts.init?.headers);
  headers.set("X-PAYMENT", encodePayment(payment));
  const paidRes = await doFetch(url, { ...opts.init, headers });

  let settlement: SettlementResponse | undefined;
  const settleHeader = paidRes.headers.get("X-PAYMENT-RESPONSE");
  if (settleHeader) {
    try {
      settlement = JSON.parse(Buffer.from(settleHeader, "base64").toString("utf-8")) as SettlementResponse;
    } catch {
      /* leave settlement undefined on a malformed header */
    }
  }

  return {
    status: paidRes.status,
    data: (await paidRes.json()) as T,
    paid: paidRes.status === 200,
    requirements,
    settlement,
  };
}
