# Aura DCA — Mô tả Submission

*Một agent DCA tự trị, xây trên Arc Network.*

*Encode Club × Circle — Programmable Money Hackathon (build trên Arc)*

Live: https://aura-dca.vercel.app
Repo: https://github.com/thanhphuc85/AuraDCA
**Swap gộp 2 user, chia pro-rata:** https://testnet.arcscan.app/tx/0xd8a19fef1527
Neo audit on-chain (contract): https://testnet.arcscan.app/address/0x4948c662630c7dE36BD59089085850c00996F661

> 🇬🇧 English version: [`SUBMISSION.md`](SUBMISSION.md)

---

## Tagline

Một agent tự trị để Claude dẫn dắt chiến lược, còn **code nắm giữ mọi con số chạm vào tiền** — và gộp lịch của nhiều người dùng thành **một cú swap on-chain cho mỗi token họ chọn, quyết toán theo tỉ lệ**. DCA vào bất kỳ token nào mạng hỗ trợ (bạn tự chọn; Arc Testnet hiện wire cirBTC và EURC) là bản triển khai tham chiếu; kiến trúc bên dưới mới là đóng góp thật.

## Vấn đề

"Tài chính điều khiển bởi agent" là một trong những chủ đề chính của hackathon, nhưng nó ẩn chứa một mâu thuẫn thật sự: LLM rất giỏi phán đoán theo ngữ cảnh, nhưng bạn *không bao giờ* được để một mô hình ngôn ngữ làm người quyết định cuối cùng về việc chuyển bao nhiêu tiền. Trao toàn quyền cho nó thì chỉ một con số ảo giác cũng có thể vét sạch ví. Tước hết quyền tự chủ thì nó chỉ còn là một cron script rườm rà.

Mâu thuẫn đó gay gắt hơn hẳn khi **tiền không phải của bạn**. Một agent phục vụ **nhiều** người phải vừa an toàn vừa công bằng: lịch của từng người được tôn trọng chính xác, tiền của từng người tách bạch khỏi người khác, và mọi phân bổ đều tái dựng được sau đó — mà vẫn phải thực thi hiệu quả on-chain, chứ không phải mỗi người một giao dịch.

## Chúng tôi đã xây gì

Một agent giải quyết cả hai nửa của bài toán đó, với **DCA là trường hợp cụ thể**:

**1. Claude quyết định chiến lược — code nắm giữ tiền.** Mỗi lần chạy, agent đưa Claude số dư thật, nhịp chi tiêu, ngân sách và lịch sử giao dịch của chính nó, rồi hỏi — qua tool call bắt buộc, validate theo schema — nên làm gì và tại sao. Claude đọc lịch sử của mình, dàn đều chi tiêu, và **từ chối giao dịch** khi nhận ra ngân sách đã hết. Nhưng câu trả lời của nó chỉ là *đề xuất*: hàm thuần `clampDecision()` đã unit-test mới tự tính lại giới hạn thật từ các guardrail cứng (tối đa/ngày, dự trữ tối thiểu, ngưỡng bụi, ngân sách chiến dịch) và là **nơi duy nhất** quyết định con số thực sự được swap. Mỗi lần chạy đều ghi lại *ràng buộc nào* đã chặn kết quả.

Ở **chế độ Smart**, agent không chỉ *chặn* lệnh mua — nó **định cỡ** lệnh, và đây là nơi LLM có quyền thật (nhưng có rào) trên số tiền. Mỗi run một lượt Claude đọc market brief + reflections của chính nó và **đề xuất một hệ số**; code clamp đề xuất đó vào biên cứng, rồi độ nhạy và hệ số tối đa của từng user chặn tiếp, và tổng pooled vẫn đi qua `clampDecision()` (max/ngày, dự trữ, cap ngày còn lại, ngân sách chiến dịch). Nếu lượt định cỡ lỗi, công thức tất định dip + Fear & Greed thế chỗ — nên phán đoán của agent làm nhúc nhích con số, nhưng chỉ trong rào do code sở hữu, và thiếu dữ liệu chỉ có thể an toàn. Mỗi lượt smart ghi hệ số, **kèm việc agent hay công thức đã chọn nó**, cùng ảnh Fear & Greed, vào [`history.json`](data/history.json) đã commit — kiểm chứng được on-chain — và dashboard hiện preview trước khi ký cùng badge `⚡🧠 ×M` (⚡ = agent tự chọn).

> Logo của chúng tôi chính là sự phân tách đó, được vẽ ra: hai quỹ đạo không bao giờ chứa nhau, chỉ gặp nhau tại đúng nơi một quyết định được đưa ra.

**2. Nhiều người dùng, một cú swap, quyết toán công bằng.** Mỗi ví tự đặt tần suất, số tiền và giới hạn riêng. Mỗi lần chạy, agent tính phần đến hạn của từng người, thực thi **tổng dưới dạng một cú swap duy nhất**, rồi phân phối token nhận về **theo tỉ lệ đóng góp** — nếu guardrail cắt tổng thì mọi phần cùng co lại theo, và phần dư làm tròn được gán tất định để **sổ sách luôn khớp**. Một giao dịch phục vụ tất cả; không ai bù cho ai. ([`schedule.ts`](src/ledger/schedule.ts), đã unit-test — và [đã chứng minh on-chain](#nó-có-chạy-không--sự-thật-trần-trụi): hai ví, một swap, chia tới đơn vị cuối.)

**3. Non-custodial ngay từ thiết kế.** Người dùng không bao giờ giao khoá. Mọi thay đổi trạng thái — đặt lịch, chạy ngay, rút tiền — đều được ủy quyền bằng **chữ ký EIP-191** do chính người dùng ký trong ví của mình và server verify trước khi chạm vào ledger. Agent có thể thực thi chiến lược; nó **không bao giờ có thể tự bịa ra sự đồng ý** của người dùng.

**4. Nó ghi nhớ.** Sau mỗi lần chạy Claude viết một reflection vào `data/reflections.json` và có thể truy xuất lại khi ra quyết định — đó chính là cách nó nhận ra outage cirBTC là *cấu trúc* và ngừng đốt phí vào đó.

**5. Nó tự neo audit trail lên on-chain.** Sổ cái gộp (`data/ledger.json` — số dư và phân bổ của mọi người) được commit vào git mỗi run, nhưng git chỉ đáng tin bằng đúng cái repo. Nên sau mỗi run agent hash sổ cái đã commit và ghi hash đó vào [`AuraAttestation.sol`](contracts/AuraAttestation.sol), một **smart contract riêng deploy trên Arc Testnet** ([`0x4948c6…F661`](https://testnet.arcscan.app/address/0x4948c662630c7dE36BD59089085850c00996F661)) mà **chỉ ví agent mới ghi được**. Bất kỳ ai cũng tính lại được `keccak256(data/ledger.json)` tại commit của một run và đối chiếu với `latestHash` on-chain — sổ sách off-chain trở nên chống-chỉnh-sửa on-chain. **Contract không giữ tiền, không chạm số dư nào**; lỗi ở đó không thể chuyển được một token, nên toàn bộ đường này là best-effort và mặc định tắt. Attestation đầu tiên, thật: [`0x2ddace…3e85`](https://testnet.arcscan.app/tx/0x2ddace0e81c82fda8691f030094cd0a9ddac78d8365116832fe4551884f13e85) (tự verify read-only bằng `npm run verify-attest`).

Bản thân giao dịch swap đi qua SDK **Swap Kit** chính thức của Circle — con đường swap duy nhất được document chính thức và khả dụng ổn định trên Arc Testnet (USDC / EURC / cirBTC). Ví là **Developer-Controlled Wallet** của Circle, nên không có private key thô nào để rò rỉ.

Toàn bộ chạy trên **GitHub Actions cron** — không cần server. Mỗi lần chạy commit kết quả ngược lại `data/history.json` trong repo, tạo ra một nhật ký kiểm toán công khai, chống chỉnh sửa, lớn dần theo thời gian.

### Dashboard — từ bot thành sản phẩm

Trên nền cron tự động, chúng tôi xây thêm một **dashboard** hoàn chỉnh (chạy tại **[aura-dca.vercel.app](https://aura-dca.vercel.app)**), biến agent thành thứ người dùng thật sự dùng được:

![Dashboard Aura DCA](docs/dashboard.png)

- **DCA per-user, non-custodial.** Người dùng kết nối ví (EIP-6963 đa ví) hoặc đăng nhập bằng email, tự đặt **tỉ lệ DCA hàng ngày** của mình; agent gộp lịch của mọi người vào mỗi lần chạy. Mọi thay đổi trạng thái (`đặt rate`, `chạy DCA ngay`, `rút tiền`) đều được ủy quyền bằng **chữ ký ví EIP-191** và verify trong serverless function trên Vercel — người dùng giữ quyền kiểm soát khóa của mình.
- **Agent hội thoại.** Trợ lý Claude (tool calling) trả lời "ngân quỹ còn bao nhiêu?", "giải thích giao dịch gần nhất"… từ dữ liệu on-chain thật; với action nhạy cảm nó chỉ **đề xuất** — người dùng xác nhận và ký trong UI trước khi thực thi.
- **Bộ nhớ vector + reflection.** Sau mỗi lần chạy Claude ghi một reflection vào `data/reflections.json`; dashboard hiển thị "bộ nhớ agent" này cùng bảng **Agent intelligence** (rủi ro / market regime / độ tự tin / pattern alerts) suy ra từ lịch sử chạy.
- **Định cỡ động thông minh.** Bật chế độ Smart thì mỗi lệnh mua theo lịch được định cỡ theo điều kiện thị trường trực tiếp (drawdown + Fear & Greed), trong biên độ nhạy và trần do bạn đặt — có preview hệ số của lượt này trước khi ký, và badge `🧠 ×M` trên mỗi lượt đã thực thi.
- **Đa agent.** Một market-analyst chạy Claude Haiku tạo bản tóm tắt thị trường mà agent quyết định chính đưa vào cân nhắc phân bổ.
- **Nó báo lại việc đã làm.** Cron đẩy thông báo Telegram mỗi lượt chạy đáng chú ý — số tiền, token, hệ số smart đã dùng (và agent hay công thức đã chọn nó), thứ đã chặn kích cỡ, kèm link tx — nên agent báo cáo cho bạn mà không cần mở dashboard.

## Nó có chạy không? — sự thật trần trụi

Bạn sẽ mở [`data/history.json`](data/history.json) và thấy nhiều dòng
`error_swap_failed`. Đây là sự thật đó, nói thẳng, trước khi bất cứ phần nào khác
của tài liệu này cố gây ấn tượng với bạn. Và đây là nửa còn lại, cũng thẳng như
vậy: luận điểm cốt lõi của dự án — *nhiều user, một cú swap, chia theo tỉ lệ* —
**đã thực thi on-chain, không ai giám sát**, trên cron mỗi giờ.

**Claim cờ đầu, đã chứng minh thật.** Run `2026-07-23T22:56Z`: hai ví độc lập
cùng đến hạn 1 USDC, agent gộp thành **một** cú swap rồi chia theo đóng góp —
[`0xd8a19f…1527`](https://testnet.arcscan.app/tx/0xd8a19fef1527ed91122ba29ec1ea9a845be1a7e3f3005450252f143956c07a19) (`2.00 USDC → 1.793953 EURC`).

| Ví | Đóng góp | Nhận về | Tỉ lệ |
|---|---|---|---|
| `0xdd6045a6…` | 1.000000 USDC | 0.896977 EURC | 50.0% |
| `0xfc337ba1…` | 1.000000 USDC | 0.896976 EURC | 50.0% |

`0.896977 + 0.896976 = 1.793953` — sổ sách khớp tuyệt đối, phần dư làm tròn được
gán tất định. Nó lặp lại ở run kế tiếp (`2026-07-24T00:04Z`,
[`0x0a7bd7…2d77`](https://testnet.arcscan.app/tx/0x0a7bd7182d773a20b8665610f58523c2bfe3edf0a515f1d419b9fc5ec71519d7)). Tổng cộng có 4
swap thành công, tất cả đều nằm trong [`data/history.json`](data/history.json)
kèm tx hash.

**Neo audit cũng tự chạy.** Cron đã ghi **14 attestation (và đang tăng)** vào
[`AuraAttestation`](https://testnet.arcscan.app/address/0x4948c662630c7dE36BD59089085850c00996F661)
mà không cần con người — mỗi cái là keccak256 của sổ cái nó vừa commit.

**Thị trường cirBTC thì không.** `USDC → cirBTC` trả về *"No route available"* ở
mọi lần thử suốt 14 ngày riêng biệt (2026-07-08 → 2026-07-23). Đó là **outage thanh khoản của Arc Testnet, không
phải bug của agent** — và `npm run check-routes` cho thấy nó chỉ giới hạn ở cirBTC,
tài sản biến động duy nhất mà Arc có (chain này stablecoin-native tới mức native gas
token cũng là USDC).

**Và agent đã xử lý đúng như ta mong muốn.** Nó nhận ra các lỗi này mang tính *cấu
trúc chứ không thoáng qua*, ghi lại lập luận đó vào [reflections](data/reflections.json)
của chính mình, giảm tần suất thử để ngừng đốt phí, và **ngừng chi tiêu để bảo toàn
vốn** — suốt cả 14 ngày outage, không ai giám sát. Biết **khi nào KHÔNG hành động** mới là nửa
khó của một agent tài chính tự trị, và đây chính là đoạn lịch sử nó bị thử thách thật.

Nên chúng tôi không che outage bằng cách ép demo chạy vào bất cứ pair nào còn quote.
Thay vào đó chúng tôi biến **token đích thành lựa chọn của từng user**: chọn EURC thì
lệnh mua settle thật ngay hôm nay (đã chứng minh on-chain); để cirBTC thì agent chờ
qua outage. EURC không phải tấm bình phong che pair chết — nó là một lựa chọn thật, và
việc tích luỹ BTC vẫn nguyên vẹn cho ai muốn. Phần [Những gì chúng tôi đã ĐO](#những-gì-chúng-tôi-đã-đo-và-thesis-chúng-tôi-tự-giết)
là lý do chúng tôi tin EURC đủ để đưa nó thành lựa chọn.

## Cách hoạt động (luồng)

```
GitHub Actions cron (mỗi giờ — lịch riêng của từng user quyết định giờ này có phải của họ)
  → đọc số dư USDC của ví Circle trên Arc Testnet
  → computeScheduledSpends(): ai đến hạn, mỗi người bao nhiêu, chặn bởi giới hạn riêng
  → Claude quyết định / tư vấn: { proceed, amountUsdc, reasoning }  (forced tool-use, validate zod)
  → clampDecision(): guardrail cứng áp số tiền thật sự
  → gộp các spend đến hạn theo token mỗi user chọn
  → Circle Swap Kit: MỘT cú swap USDC → token cho mỗi nhóm token (hoặc dry-run)
  → applyScheduledDistribution(): chia pro-rata từng nhóm lại cho user của nó
  → ghi vào data/history.json  →  commit ngược lại repo
  → AuraAttestation.attest(keccak256(data/ledger.json)) — neo trạng thái đã commit lên on-chain
```

## Công nghệ

- **TypeScript / Node.js**, chạy trực tiếp bằng `tsx` (không cần build step)
- **Anthropic Claude** (`@anthropic-ai/sdk`) — bộ máy ra quyết định, qua forced tool-use + validate zod
- **Circle Swap Kit** (`@circle-fin/swap-kit`) + **Developer-Controlled Wallets** (`@circle-fin/developer-controlled-wallets`) + Circle Wallets adapter
- **Arc Testnet** (L1 EVM stablecoin-native của Circle; gas trả bằng USDC)
- **Solidity** — [`AuraAttestation.sol`](contracts/AuraAttestation.sol), một neo audit on-chain không-giữ-tiền deploy trên Arc Testnet; agent ghi `keccak256(data/ledger.json)` mỗi run và ai cũng tái lập read-only được bằng `npm run verify-attest`
- **GitHub Actions** cho lịch chạy, secrets và nhật ký kiểm toán commit-back — cùng lượt chạy đó cũng ghi attestation on-chain và đẩy thông báo Telegram
- **Vitest** — 65 unit test cho các đường đi quan trọng về an toàn: guardrail `clampDecision()` (giờ là quyền trên cả tổng pooled), quyết toán pro-rata khi gộp lệnh (gồm gộp-theo-token), biên định cỡ smart (công thức + clamp trên hệ số agent tự đề xuất, biên độ nhạy/trần theo user), hash audit on-chain, và phép tính số ngày outage/campaign mà agent dùng để lý luận
- **Vercel** serverless (`api/`) cho các action có ký của dashboard — set-rate, run-DCA, rút tiền, chat, email chào mừng
- **Dashboard một file** (`docs/index.html`) — phát hiện ví EIP-6963, ký EIP-191, song ngữ Anh/Việt, sáng/tối

## Những gì chúng tôi đã ĐO (và thesis chúng tôi tự giết)

Khi route cirBTC chết, nước đi hấp dẫn là xoay thesis sang thứ còn chạy được.
Chúng tôi suýt làm vậy — một agent rebalance ngân quỹ USDC/EURC: cùng engine lịch,
cùng guardrails, và EURC là cặp duy nhất còn quote được.

Nhưng chúng tôi **đo trước**, vì cú cirBTC đã dạy đúng bài học: **chúng tôi đã đặt
cược vào thứ mình chưa bao giờ kiểm chứng.** Nên trước khi đổ vào 2 tuần, chúng tôi
lấy mẫu tỉ giá EURC (`npm run sample-fx`, chỉ đọc).

Nửa giờ đầu trông như án tử — chín lần đọc giống hệt nhau, `1.1451554658` không sai
một lần. Chúng tôi suýt gạch bỏ pivot này là bất khả thi. Rồi chúng tôi **để sampler
chạy tiếp**:

```
03:04 → 03:48   1.1451554658   (đứng im 48 phút)
03:53           1.1426120287   ← −0.2226%
03:58           1.1426120287
```

**Tỉ giá không hề bị ghim — oracle chỉ cập nhật theo bước thô, khoảng mỗi giờ, và
cửa sổ lấy mẫu đầu tiên của chúng tôi rơi trọn vẹn vào bên trong một bước.** Chỉ với
nửa giờ dữ liệu, chúng tôi đã tự tin báo cáo một thị trường đóng băng. Phát hiện thật
không phải "EURC chết", mà là "chúng tôi chưa lấy mẫu đủ lâu để thấy nó thở".

Sự đính chính đó chỉ xảy ra vì chúng tôi **tiếp tục đo sau khi đã tưởng có câu trả
lời** — và đây là phần chúng tôi bảo vệ mạnh nhất. Ba công cụ đo
([`check-routes`](scripts/check-routes.mjs), [`prove-swap`](scripts/prove-swap.mjs),
[`sample-fx`](scripts/sample-fx.mjs)) đều nằm trong repo và tái lập được;
`data/fx-samples.json` là chuỗi dữ liệu thô đứng sau các con số trên.

Những gì các phép đo thật sự xác lập:

| Tài sản | Trạng thái đo được |
|---|---|
| cirBTC | Không thanh khoản — `No route available` ở mọi lần thử, 14 ngày riêng biệt và đang tiếp diễn |
| EURC | Sống, và tỉ giá **có di chuyển** — theo bước ~mỗi giờ, biên độ ~0.22% |
| WBTC / WETH / USDT / DAI / … | Không hề được wire cho Arc Testnet |

Vậy là pivot **khả thi thật** — và cái hay là chúng tôi không phải chọn một trong hai.
Biến **toàn bộ** sản phẩm thành một agent rebalance ngoại hối USDC/EURC thì đúng là một
sản phẩm khác với thứ người dùng cần. Nhưng **đưa EURC thành một token trong nhiều lựa
chọn — trong khi cirBTC vẫn là đích BTC biến động — KHÔNG phải pivot đó.** Đó chính là
sự tổng quát hoá multi-token mà chúng tôi đã ship: token đích giờ là lựa chọn của từng
user, nên EURC chạy thật cho ai muốn, còn tích luỹ BTC thì nguyên vẹn. Việc đo lường là
thứ cho phép chúng tôi đưa EURC một cách trung thực, như một lựa chọn thật chứ không
phải trò gian demo.

Lập trường trung thực: **agent đúng, thị trường cirBTC thì rỗng** — và chúng tôi có
dữ liệu để chỉ ra bên nào là bên nào, kể cả dữ liệu chứng minh kết luận đầu tiên của
chính chúng tôi là sai.

## Điểm nổi bật

- **Claim khó đã được chứng minh, không chỉ nói** — "nhiều user, một swap, chia pro-rata" là phần mà đa số dự án agent chỉ mô tả. Của chúng tôi đã làm on-chain, không giám sát, hai lần: hai ví gộp thành một swap và chia tới đơn vị cuối.
- **Thực thi thật, kiểm chứng được** — không phải video demo. Swap thật, phân phối per-user thật, và các CI run xanh mà ai cũng kiểm tra được.
- **Kiến trúc an toàn** — sự phân tách "LLM đề xuất / code quyết định" chính là cốt lõi, được thực thi bằng một hàm thuần đã test cộng cơ chế hai công tắc cho giao dịch thật (`DRY_RUN` + `LIVE_TRADING_ENABLED`). Cách agent đọc thị trường làm nhúc nhích kích cỡ lệnh, nhưng chỉ trong biên do code sở hữu.
- **Tự audit on-chain** — 14+ attestation do cron ghi, không cần con người; ai cũng tính lại được hash từ repo công khai.
- **Tự chủ thật sự** — tự host trên CI miễn phí, tự lưu lịch sử qua commit, lý luận trên các lần chạy trước, và báo Telegram mỗi lượt.

## Khó khăn đã gặp

- **Cặp cirBTC rơi vào outage thanh khoản** — khó khăn lớn nhất, đã trình bày ở [Nó có chạy không?](#nó-có-chạy-không--sự-thật-trần-trụi) và [Những gì chúng tôi đã ĐO](#những-gì-chúng-tôi-đã-đo-và-thesis-chúng-tôi-tự-giết). Tóm lại: chúng tôi coi đó là bài toán **đo lường** chứ không phải cái cớ, và viết các công cụ để mọi khẳng định ở đây đều kiểm chứng được.
- **Arc Testnet không có "altcoin thật"** — các DEX cộng đồng (ArcSwap/Presto/…) không có địa chỉ contract được xác minh công khai, nên chúng tôi chủ động chuẩn hóa theo Swap Kit chính thức của Circle (USDC↔EURC↔cirBTC) để submission thật sự chạy được.
- **Chính chỉ số của chúng tôi đã nói dối agent.** `dayCount()` trả về `history.length + 1` — tức **số lần chạy** — nhưng nó đi thẳng vào decision context dưới tên `dayCount` và Claude dùng nó để lý luận về nhịp chi tiêu. Với 3 lần chạy/ngày, agent tưởng mình đang ở "ngày 21" sau một tuần, và reflections của nó **thổi phồng độ dài outage lên ~3 lần**; khi cron chuyển sang mỗi giờ thì nó sẽ trôi nhanh gấp 24 lần thời gian thật. Phát hiện khi fact-check chính tài liệu này với `history.json` — con số "20+ ngày" chúng tôi từng viết đến từ phép tính đã hỏng của chính agent. `dayCount` giờ đếm số ngày khác nhau và có test hồi quy. **Một agent lý luận từ con số bị dán nhãn sai thì sai một cách rất tự tin, và output nhìn không có gì hỏng cả** — đó chính là toàn bộ lý lẽ cho việc giữ quyền quyết định tiền trong code đã test, thay vì trong mô hình.
- **Đọc lỗi không phải là số 0.** RPC công khai của Arc rate-limit khi gọi dồn (`-32011`), và vài chỗ đọc trên dashboard ép response lỗi đó thành `0x0`. Treasury hiện `cirBTC 0 · EURC 0` trong khi ví giữ 22.68 EURC on-chain; trang deposits hiện "chưa ai nạp" trong khi ledger có 35 USDC qua 4 lượt. Nhìn không có gì hỏng — nó trông *trống rỗng*, nguy hiểm hơn nhiều trên trang mà cả luận điểm là minh bạch. Giờ các hàm đọc **retry có backoff rồi ném lỗi** thay vì bịa số 0; nơi gọi hiện "—" hoặc bỏ dòng. Cùng bài học với `dayCount`, ở một lớp khác: **một con số sai mà trông hợp lý thì giỏi che giấu hơn một lỗi ồn ào.**
- **Đóng gói SDK của Circle** — yêu cầu Node ≥ 22 và có những đặc thù ESM named-export chỉ lộ ra trên một số phiên bản Node nhất định; đã ghim CI về Node 24 để khớp môi trường đã kiểm chứng.
- **Decimals của token không thể thay cho nhau.** Rút EURC lỗi "Invalid amounts in transfer request" vì client format mọi token khác USDC thành 8 chữ số lẻ; EURC là 6, và Circle từ chối phần dư. Đã vá cả hai đầu — client map decimals theo từng token, và API chuẩn hoá lại trước khi gọi Circle, nên không client cũ nào tái hiện được.
- **Config chuỗi rỗng trong CI** — biến GitHub Actions chưa set sẽ đến dưới dạng `""`, mà `.default()` của zod không lấp `""`; đã sửa bằng bước tiền xử lý chuyển rỗng thành undefined.

## Hướng phát triển tiếp

- **Lựa chọn token theo user đã ship** — mỗi ví tự chọn đích (cirBTC hoặc EURC hôm nay), mỗi lượt chạy settle một swap gộp cho mỗi token. Bước tiếp theo là để Claude *tự quyết* tỷ lệ phân bổ trên nhiều tài sản **biến động** — cần Arc wire thêm hơn một; mở khoá vào ngày thị trường cirBTC trở lại hoặc Arc niêm yết token khác.
- Bảng P&L / giá vốn trực tiếp — chart giá-fill theo token đã vẽ đúng tỉ giá EURC thật agent trả mỗi run; giá vốn là lớp tiếp theo, và cirBTC tự nhập cuộc ngày route trở lại
- Verify domain gửi email để email chào mừng tới được mọi user, không chỉ hộp thư người vận hành
- Rà soát sẵn sàng cho mainnet khi Arc mainnet ra mắt

> Kể từ submission đầu, chúng tôi phát triển từ một bot cron không giao diện thành sản phẩm dùng được — rồi chứng minh đúng phần quan trọng. Swap gộp nhiều-user thôi là sơ đồ kiến trúc và trở thành hai giao dịch on-chain chia tới đơn vị cuối; agent có được quyền tự chủ (có rào) trên kích cỡ lệnh của chính nó; và giờ nó neo ledger lên on-chain cùng báo Telegram mỗi run, không ai giám sát. Vẫn cùng một guardrail "code nắm giữ tiền" xuyên suốt.

## Thương hiệu & nhãn hiệu

**Aura DCA là dự án độc lập, xây trên Arc Network — không liên kết, không được Circle bảo trợ, và không phải sản phẩm của Circle.**

Đã đối chiếu với [Arc brand guidelines and partner toolkit](https://www.arc.io/brand-guidelines-and-partner-toolkit):
tên sản phẩm và logo là **của riêng Aura** ("Arc" không xuất hiện ở cả hai); Arc chỉ được nhắc
theo đúng nghĩa factual được phép (*built on Arc Network*, *on Arc Testnet*), không bao giờ như
một sự bảo trợ; dùng "Arc Network" ở lần nhắc đầu tiên; và chúng tôi **không** dùng bất kỳ brand
asset nào của Arc/Circle — cách đơn giản nhất để tôn trọng quy định về việc chỉnh sửa hay làm lấn
át mark của họ. Bảng đối chiếu từng điểm nằm ở [README](README.md#brand--trademark).

## Lưu ý an toàn

Chỉ testnet. Token là token faucet không có giá trị. Guardrail được thực thi bằng code, không phải bởi mô hình; giao dịch thật cần bật hai công tắc riêng biệt.
