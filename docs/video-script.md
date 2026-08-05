# Aura DCA — Video Script / Kịch bản video

**Target length / Thời lượng mục tiêu:** ~3:30–4:00 · **Format:** screen recording of `docs/pitch-deck.html` + live browser cutaways.

---

## How to record / Cách quay

1. Open the deck full-screen: `docs/pitch-deck.html` → press **F** for fullscreen. Navigate with **→ / Space**.
2. Have two browser tabs ready for the live cutaways:
   - **Dashboard** — https://aura-dca.xyz
   - **The pooled swap on ArcScan** — https://testnet.arcscan.app/tx/0xd8a19fef1527ed91122ba29ec1ea9a845be1a7e3f3005450252f143956c07a19
3. Record at 1080p, 30fps. Keep the cursor calm. Advance the slide on the sentence marked **[NEXT ▶]**.
4. Two takes: one EN, one VI. The slide deck is in English; for the VI take, just read the Vietnamese narration over the same slides.

> **Timing column** is cumulative (mm:ss). Treat it as a guide, not a metronome.

---

## Shot list / Bảng phân cảnh

| # | Slide | Time | Cutaway |
|---|---|---|---|
| 1 | Title | 0:00 | Deck |
| 2 | Problem | 0:22 | Deck |
| 3 | Solution | 0:45 | Deck |
| 4 | Flagship claim | 1:12 | Deck |
| 5 | Proven on-chain | 1:32 | **→ ArcScan tx** |
| 6 | Non-custodial | 2:05 | Deck (opt. dashboard login) |
| 7 | Self-audit | 2:28 | Deck |
| 8 | Honest state | 2:48 | Deck (opt. history.json) |
| 9 | x402 | 3:12 | Deck (opt. terminal) |
| 10 | Tech & safety | 3:30 | Deck |
| 11 | Standout | 3:45 | Deck |
| 12 | Close | 4:00 | **→ Dashboard** |

---

## Slide 1 — Title · 0:00

**EN.** "Meet Aura DCA — an autonomous dollar-cost-averaging agent built on Arc Network. Its whole idea fits in one line: let Claude drive the strategy, but let code own every number that touches money. **[NEXT ▶]**"

**VI.** "Đây là Aura DCA — một agent DCA tự động xây trên Arc Network. Toàn bộ ý tưởng gói trong một câu: để Claude điều khiển chiến lược, nhưng để code nắm quyền trên mọi con số chạm đến tiền. **[NEXT ▶]**"

## Slide 2 — Problem · 0:22

**EN.** "Agent-driven finance hides a real tension. An LLM is brilliant at judgment — but you can never let it be the final authority on how much money to move. One hallucinated number drains the wallet. And the moment the money isn't yours, the agent has to be fair as well as safe: every user's schedule honoured, every user's funds ring-fenced. **[NEXT ▶]**"

**VI.** "Tài chính điều khiển bởi agent ẩn một mâu thuẫn thật sự. LLM rất giỏi phán đoán — nhưng bạn không bao giờ được để nó quyết định cuối cùng số tiền cần chuyển. Một con số ảo giác là cạn ví. Và khi tiền không phải của bạn, agent phải vừa công bằng vừa an toàn: lịch của mỗi người được tôn trọng, tiền của mỗi người tách bạch. **[NEXT ▶]**"

## Slide 3 — Solution · 0:45

**EN.** "Here's how we resolve it. Claude *recommends* — it reads the balance, the budget, its own trade history, and proposes an amount with reasoning, through a forced, schema-validated tool call. But `clampDecision` — a pure, unit-tested function — re-derives the real limit from hard guardrails and *decides* the number actually spent. Claude is never trusted with the final figure, and every run records which rule bound the result. That split *is* our logo: two orbits that meet only at the decision. **[NEXT ▶]**"

**VI.** "Chúng tôi giải quyết như sau. Claude *đề xuất* — đọc số dư, ngân sách, lịch sử giao dịch của chính nó, rồi đưa ra số tiền kèm lý do qua một lời gọi tool được ép và validate bằng schema. Nhưng `clampDecision` — một hàm thuần, có unit test — tự tính lại giới hạn thật từ các guardrail cứng và *quyết định* con số thực sự được chi. Claude không bao giờ được tin với con số cuối, và mỗi lần chạy đều ghi lại ràng buộc nào đã chặn kết quả. Sự phân tách đó chính là logo của chúng tôi: hai quỹ đạo chỉ gặp nhau tại điểm ra quyết định. **[NEXT ▶]**"

## Slide 4 — Flagship claim · 1:12

**EN.** "Now the hard part — serving many users at once. Each wallet sets its own cadence and caps. Every run, the agent adds up who's due, executes the sum as a *single* swap, then splits the proceeds pro-rata by contribution — assigning the rounding remainder deterministically so the books always close. One transaction serves everyone; nobody subsidises anyone. **[NEXT ▶]**"

**VI.** "Giờ đến phần khó — phục vụ nhiều người cùng lúc. Mỗi ví tự đặt nhịp độ và trần riêng. Mỗi lần chạy, agent cộng dồn ai đến hạn, thực thi tổng cộng như *một* giao dịch swap, rồi chia phần nhận về theo tỷ lệ đóng góp — gán phần dư làm tròn một cách tất định để sổ sách luôn khớp. Một giao dịch phục vụ tất cả; không ai bù cho ai. **[NEXT ▶]**"

## Slide 5 — Proven on-chain · 1:32 · → CUT TO ARCSCAN

**EN.** "And this isn't a diagram — it ran on-chain, unsupervised. Two wallets, one USDC each, pooled into a single two-USDC swap into EURC, split 0.896977 and 0.896976 — adding back to the exact total. **[CUT TO ArcScan tab]** Here's that transaction on ArcScan — the swap is real, and the links are the source of truth. **[CUT BACK, NEXT ▶]**"

**VI.** "Và đây không phải sơ đồ — nó đã chạy on-chain, không người giám sát. Hai ví, mỗi ví một USDC, gộp thành một giao dịch swap hai USDC sang EURC, chia 0.896977 và 0.896976 — cộng lại đúng bằng tổng. **[CHUYỂN SANG tab ArcScan]** Đây là giao dịch đó trên ArcScan — swap là thật, và các đường link là nguồn sự thật. **[QUAY LẠI, NEXT ▶]**"

## Slide 6 — Non-custodial · 2:05

**EN.** "It's non-custodial by construction, using *both* halves of Circle's wallet stack. The agent runs on a Developer-Controlled Wallet — no raw key to leak. And end users just 'Sign in with Google' to mint a real Circle User-Controlled Wallet on Arc — no MetaMask, no seed phrase. Every action is authorised by the user's own signature; the agent can execute, but it can never invent your consent. **[NEXT ▶]**"

**VI.** "Nó phi lưu ký ngay từ thiết kế, dùng *cả hai* nửa của bộ ví Circle. Agent chạy trên Developer-Controlled Wallet — không có khóa thô để rò rỉ. Còn người dùng chỉ cần 'Đăng nhập với Google' để tạo một Circle User-Controlled Wallet thật trên Arc — không MetaMask, không seed phrase. Mọi hành động đều được ủy quyền bằng chữ ký của chính người dùng; agent có thể thực thi, nhưng không bao giờ tự bịa sự đồng ý của bạn. **[NEXT ▶]**"

## Slide 7 — Self-audit · 2:28

**EN.** "It even audits itself. After every run the agent hashes its committed ledger and records that hash in a purpose-built Arc Testnet contract only its wallet can write to. Fourteen-plus attestations, written by the cron with no human in the loop. The contract holds no funds — a bug there can't move a token — and anyone can recompute the hash read-only. **[NEXT ▶]**"

**VI.** "Nó thậm chí tự kiểm toán. Sau mỗi lần chạy, agent băm sổ cái đã commit và ghi hash đó vào một hợp đồng chuyên dụng trên Arc Testnet mà chỉ ví của nó được ghi. Hơn mười bốn attestation, do cron ghi, không con người tham gia. Hợp đồng không giữ tiền — một lỗi ở đó cũng không di chuyển được token — và bất kỳ ai cũng tính lại được hash ở chế độ chỉ đọc. **[NEXT ▶]**"

## Slide 8 — Honest state · 2:48

**EN.** "Now the honest part. The cirBTC route on Arc Testnet went into a liquidity outage — 'no route available' for fourteen straight days. That's the market, not a bug — and we can prove it's isolated to cirBTC. What matters is how the agent reacted: it recognised the failure as *structural*, wrote that to its own reflections, and withheld spend to preserve capital — unsupervised. Knowing when *not* to act is the harder half of an autonomous money agent. **[NEXT ▶]**"

**VI.** "Giờ đến phần trung thực. Tuyến cirBTC trên Arc Testnet gặp sự cố thanh khoản — 'không có route' suốt mười bốn ngày liền. Đó là thị trường, không phải lỗi — và chúng tôi chứng minh được nó chỉ cô lập ở cirBTC. Điều quan trọng là cách agent phản ứng: nó nhận ra lỗi mang tính *cấu trúc*, ghi vào reflections của chính nó, và giữ lại tiền để bảo toàn vốn — không người giám sát. Biết khi nào *không* hành động là nửa khó hơn của một agent quản tiền tự động. **[NEXT ▶]**"

## Slide 9 — x402 · 3:12

**EN.** "One layer deeper into programmable money: the agent can pay for its *own* inputs. Over x402 — HTTP 402 Payment Required — it unlocks a metered market brief with a signed USDC authorization, EIP-3009. One command, no keys, reproduces the whole handshake. It's cryptographically verified, settlement gated off — an additive module that never touches the DCA path. **[NEXT ▶]**"

**VI.** "Sâu thêm một lớp vào programmable money: agent có thể tự trả tiền cho đầu vào của *chính nó*. Qua x402 — HTTP 402 Payment Required — nó mở khóa một bản tin thị trường có tính phí bằng một ủy quyền USDC đã ký, EIP-3009. Một lệnh, không cần khóa, tái hiện toàn bộ quá trình bắt tay. Được xác minh bằng mật mã, phần settle bị khóa — một module cộng thêm không hề chạm vào đường DCA. **[NEXT ▶]**"

## Slide 10 — Tech & safety · 3:30

**EN.** "Under the hood: TypeScript and Claude via validated tool-use, Circle Swap Kit and both wallet types, a Solidity audit anchor, and a GitHub Actions cron — so there's no server to host. Sixty-five unit tests guard the money path, and live trading needs two separate switches enabled. Tested code owns the money. **[NEXT ▶]**"

**VI.** "Bên trong: TypeScript và Claude qua tool-use đã validate, Circle Swap Kit cùng cả hai loại ví, một neo kiểm toán bằng Solidity, và một cron GitHub Actions — nên không cần server. Sáu mươi lăm unit test canh đường tiền, và giao dịch thật cần bật hai công tắc riêng biệt. Code đã test nắm quyền trên tiền. **[NEXT ▶]**"

## Slide 11 — Standout · 3:45

**EN.** "So what sets it apart? The hard claim is *proven*, not asserted — many users, one swap, split to the last unit, twice, unsupervised. Real, verifiable execution instead of a demo video. A safety architecture where code, not the model, owns the money. And an agent that audits itself on-chain and reports every run. **[NEXT ▶]**"

**VI.** "Vậy điều gì làm nó khác biệt? Tuyên bố khó được *chứng minh*, không phải khẳng định suông — nhiều người, một swap, chia đến đơn vị cuối, hai lần, không giám sát. Thực thi thật, kiểm chứng được, thay vì một video demo. Một kiến trúc an toàn nơi code, chứ không phải mô hình, nắm quyền trên tiền. Và một agent tự kiểm toán on-chain và báo cáo mỗi lần chạy. **[NEXT ▶]**"

## Slide 12 — Close · 4:00 · → CUT TO DASHBOARD

**EN.** "Two independent paths — Claude's judgment and the code's guardrails — meeting at every decision. That intersection is exactly where the safety of an LLM-driven money agent lives. **[CUT TO dashboard]** It's live at aura-dca.xyz, the code is open, and every claim here is verifiable on-chain. Thanks for watching."

**VI.** "Hai con đường độc lập — phán đoán của Claude và guardrail của code — gặp nhau tại mỗi quyết định. Chính giao điểm đó là nơi trú ngụ sự an toàn của một agent quản tiền điều khiển bởi LLM. **[CHUYỂN SANG dashboard]** Nó đang chạy tại aura-dca.xyz, mã nguồn mở, và mọi tuyên bố ở đây đều kiểm chứng được on-chain. Cảm ơn đã theo dõi."

---

## Delivery notes / Ghi chú trình bày

- **Pace / Nhịp:** EN ~150 wpm; leave a half-second of silence after each slide transition.
- **Tone:** confident, plain, no hype. The honest-state slide (8) is the trust moment — slow down there.
- **B-roll options:** on slide 5 hover the ArcScan token-transfer rows; on slide 8 you can briefly scroll `data/history.json`; on slide 9 show `npm run x402-demo` printing `✅ VERIFIED`.
- **Lower-third suggestion:** keep the repo URL `github.com/thanhphuc85/AuraDCA` pinned in a corner throughout.
