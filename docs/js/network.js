// Arc network config for the dashboard — THE single place to change for mainnet.
//
// Defaults below = Arc PUBLIC TESTNET. Two ways to point the dashboard at Arc
// mainnet once it opens (Arc mainnet is not live yet):
//   1. Edit the DEFAULTS here and redeploy, OR
//   2. Without touching this file, define `window.ARC_NET = { ... }` BEFORE this
//      module loads (e.g. a small inline <script> or a separate config file on a
//      static host). Any keys you provide override the matching defaults.
//
// This mirrors the backend's env-driven Arc config (see .env.example): the agent
// switches networks via env, the static dashboard via this object.
const DEFAULTS = {
  chainIdHex: "0x4cef52",                                   // 5042002 (Arc public testnet)
  chainName: "Arc Testnet",
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  faucet: "https://faucet.circle.com",
  usdc: "0x3600000000000000000000000000000000000000",       // ERC-20 USDC, 6 decimals
  cirbtc: "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf",     // cirBTC, 8 decimals
  eurc: "0x89b50855aa3be2f677cd6303cec089b5f319d72a",       // EURC, 6 decimals (verified on-chain)
  agent: "0x00Ebbd3aFCCaD08970ED8FdaE591244c8475a0aC",      // the agent's Circle wallet (DCA treasury)
};

const override = (typeof window !== "undefined" && window.ARC_NET) || {};
export const ARC = Object.assign({}, DEFAULTS, override);
