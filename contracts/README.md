# On-chain audit anchor — `AuraAttestation`

A tiny smart contract that turns Aura's git-committed audit trail into a
**tamper-evident, on-chain** one. After each run the agent hashes the committed
`data/ledger.json` and records that hash in this contract. Anyone can later
recompute `keccak256(bytes of data/ledger.json)` at the run's commit and check it
against the on-chain `latestHash`.

**It holds no funds and touches no balances.** It only stores hashes — the money
path stays entirely in Circle Swap Kit + `clampDecision()`. A bug here cannot move
a token; the worst case is a missing attestation, which is why the whole feature
is best-effort and off by default.

## Contract

[`AuraAttestation.sol`](AuraAttestation.sol) — `attest(bytes32 ledgerHash, string ref)`,
restricted to a single `writer` set once at deploy (the agent's Circle wallet).
Public getters: `writer`, `count`, `latestHash`, `latestTimestamp`.

## Deploy (one time)

The **writer** must be the agent's on-chain wallet so only the agent can attest.
That address is [`ARC_AGENT_ADDRESS`](../src/ledger/constants.ts):

```
0x00Ebbd3aFCCaD08970ED8FdaE591244c8475a0aC
```

Whoever deploys is irrelevant — the writer is the constructor argument, not the
deployer — so deploy from any funded Arc Testnet account.

### Option A — Remix (no repo toolchain)

1. Open <https://remix.ethereum.org>, paste `AuraAttestation.sol`, compile with
   Solidity **0.8.24**.
2. In *Deploy & Run*, set **Environment → Injected Provider** and point MetaMask at
   Arc Testnet:
   - RPC: `https://rpc.testnet.arc.network`
   - Chain ID: `5042002`
   - Explorer: `https://testnet.arcscan.app`
   - Fund the deployer with testnet USDC (gas is paid in USDC on Arc).
3. In the constructor field enter the writer address above, click **Deploy**.
4. Copy the deployed contract address.

### Option B — Circle Developer-Controlled Wallet

The agent wallet can deploy itself via Circle's `deployContract` (needs the
compiled ABI + bytecode). Option A is simpler for a one-off; use B only if you
want the deploy tx to originate from the agent wallet too.

## Wire it up

Set two env vars (locally in `.env`, and as GitHub Actions **variables** for the
cron):

```
ATTESTATION_CONTRACT=0x<deployed address>
ATTESTATION_ENABLED=true
```

`ATTESTATION_CONTRACT` alone does nothing until `ATTESTATION_ENABLED=true`. Once
both are set, every run appends an on-chain attestation after committing the
ledger (best-effort — a failure is logged, never fatal).

## Produce the first proof

Record one attestation immediately, without waiting for a DCA run:

```bash
npm run attest
```

Then verify it — read-only, no wallet, no gas:

```bash
npm run verify-attest
```

It reads `writer` / `count` / `latestHash` / `latestTimestamp` from the contract
over RPC, recomputes the hash of your local `data/ledger.json`, and reports
whether they match.

## Third-party verification recipe

Anyone can confirm an anchor with only the public repo and a block explorer:

1. Read `latestHash` (and `count`) on the contract in `testnet.arcscan.app`.
2. Check out the git commit the agent made for that run (the `Attested` event's
   `ref` is the run's ISO timestamp).
3. Compute `keccak256` of that commit's `data/ledger.json` bytes.
4. It must equal `latestHash`.

The hash function is exactly `keccak256(utf8 bytes of the file)` — locked by a
unit test in [`src/__tests__/ledgerHash.test.ts`](../src/__tests__/ledgerHash.test.ts).
