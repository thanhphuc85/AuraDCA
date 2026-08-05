# Aura DCA — Bài thuyết trình Hackathon

*Một agent DCA tự động: để Claude điều khiển chiến lược, còn code nắm quyền trên mọi con số chạm đến tiền — xây trên Arc Network.*

**Encode Club × Circle — Programmable Money Hackathon**

| | |
|---|---|
| 🌐 Dashboard live | **https://aura-dca.xyz** |
| 💾 Mã nguồn | https://github.com/thanhphuc85/AuraDCA |
| 🔗 Bằng chứng on-chain chủ lực | [Gộp 2 người dùng, 1 swap, chia theo tỷ lệ](https://testnet.arcscan.app/tx/0xd8a19fef1527ed91122ba29ec1ea9a845be1a7e3f3005450252f143956c07a19) |
| ⚓ Neo kiểm toán on-chain | [Hợp đồng `AuraAttestation`](https://testnet.arcscan.app/address/0x4948c662630c7dE36BD59089085850c00996F661) |

---

## 1. Pitch một câu

Một agent tự động để **Claude điều khiển chiến lược**, còn **code nắm quyền trên mọi con số chạm đến tiền** — gộp lịch DCA của nhiều người dùng thành **một giao dịch swap on-chain cho mỗi token, chia theo tỷ lệ đóng góp**. DCA (trung bình giá) chỉ là bản triển khai tham chiếu; **kiến trúc an toàn bên dưới mới là đóng góp chính**.

## 2. Vấn đề

"Tài chính điều khiển bởi agent" ẩn chứa một mâu thuẫn thật sự:

> LLM rất giỏi phán đoán theo ngữ cảnh — nhưng bạn **không bao giờ** được để một mô hình ngôn ngữ làm người quyết định cuối cùng số tiền cần chuyển.

Trao chìa khóa cho nó, một con số "ảo giác" là cạn ví. Tước hết quyền tự chủ, nó chỉ còn là một script cron rườm rà.

Mâu thuẫn càng gay gắt khi tiền **không phải của bạn**. Một agent phục vụ **nhiều** người dùng phải vừa **công bằng** vừa **an toàn**:

- lịch của mỗi người được tôn trọng chính xác,
- tiền của mỗi người tách bạch khỏi người khác,
- mọi phân bổ đều tái dựng lại được sau này,
- mà vẫn thực thi hiệu quả on-chain — không phải mỗi người một giao dịch.

## 3. Giải pháp — Claude *đề xuất*, code *quyết định*

Quyết định thiết kế cốt lõi, được vẽ thành logo của chúng tôi: **hai quỹ đạo không bao giờ chứa nhau, chỉ gặp nhau đúng tại khoảnh khắc ra quyết định.**

|  | **Claude** (agent) | **`clampDecision()`** (code) |
|---|---|---|
| Vai trò | **Đề xuất** số tiền + lý do | **Quyết định** số tiền thực sự được swap |
| Đầu vào | Số dư, số ngày, ngân sách, lịch sử gần đây | Đề xuất của Claude + guardrail cứng |
| Đầu ra | `{ proceed, amountUsdc, reasoning }` (ép tool-use, validate bằng zod) | Số đã clamp, hoặc bỏ qua kèm lý do được ghi lại |
| Độ tin | **Không bao giờ** được tin với con số cuối | **Quyền tối cao**; hàm thuần; có unit test |

Mỗi lần chạy đều ghi lại **ràng buộc nào** đã chặn kết quả (`boundBy`) — nên nhật ký kiểm toán minh bạch về việc phán đoán của Claude hay một trần cứng đã quyết định.

Ở **chế độ Smart**, agent không chỉ *gác cổng* lệnh mua — nó còn **định cỡ** lệnh. Một lượt Claude sizing đọc bản tin thị trường và đề xuất một hệ số nhân; code kẹp hệ số đó vào một biên cứng, độ nhạy/trần của từng người dùng ràng buộc thêm, và tổng gộp *vẫn* đi qua `clampDecision()`. Nếu lượt sizing không khả dụng, một công thức tất định (mức sụt giá + chỉ số Sợ hãi & Tham lam) tiếp quản. **Phán đoán của agent làm dịch chuyển con số — nhưng chỉ bên trong đường ray do code sở hữu.**

## 4. Tuyên bố chủ lực — nhiều người, một swap, chia công bằng

Mỗi ví tự đặt nhịp độ, số tiền và trần của riêng mình. Mỗi lần chạy, agent:

1. tính khoản chi đến hạn của từng người,
2. thực thi **tổng cộng như một giao dịch swap duy nhất**,
3. phân phối token nhận về **theo tỷ lệ đóng góp** — nếu guardrail chặn tổng thì thu nhỏ mọi phần đồng đều, và gán phần dư làm tròn một cách tất định để sổ sách luôn khớp.

**Một giao dịch phục vụ tất cả; không ai bù cho ai.**

## 5. Đã chứng minh on-chain — không phải mô phỏng

Phần mà đa số dự án agent chỉ *mô tả*, chúng tôi đã **làm** on-chain, không người giám sát, trên cron chạy mỗi giờ:

**Swap gộp 2 người dùng** — [`0xd8a19f…1527`](https://testnet.arcscan.app/tx/0xd8a19fef1527ed91122ba29ec1ea9a845be1a7e3f3005450252f143956c07a19)

| Ví | Đóng góp | Nhận về | Tỷ lệ |
|---|---|---|---|
| `0xdd6045a6…` | 1.000000 USDC | 0.896977 EURC | 50.0% |
| `0xfc337ba1…` | 1.000000 USDC | 0.896976 EURC | 50.0% |

`0.896977 + 0.896976 = 1.793953` — **sổ sách khớp chính xác**, đến đơn vị cuối cùng. Nó lặp lại ở lần chạy kế tiếp. Tổng cộng 4 swap thành công được ghi nhận, mỗi cái đều có tx hash trong [`data/history.json`](data/history.json).

## 6. Phi lưu ký từ trong thiết kế — dùng cả hai loại ví Circle

Người dùng không bao giờ giao chìa khóa. Mọi thay đổi trạng thái — đặt lịch, chạy ngay, rút tiền — đều được ủy quyền bằng một chữ ký người dùng tự ký trong ví **của chính họ**, xác minh phía server. Agent có thể thực thi chiến lược; nhưng **không bao giờ tự bịa ra sự đồng ý của người dùng**.

Chúng tôi dùng *cả hai* nửa của bộ ví Circle:

- **Agent** chạy trên **Developer-Controlled Wallet** — Circle giữ khóa ký phía server, nên không có private key thô nào để rò rỉ trong secret của CI.
- **Người dùng cuối onboard bằng "Đăng nhập với Google"** → một **Circle User-Controlled Wallet** thật, phi lưu ký, trên Arc (khóa MPC, khôi phục bằng PIN — **không cần MetaMask, không cần seed phrase**).

Đã chứng minh live end-to-end: đăng nhập Google → tạo ví trên Arc → nạp USDC qua một challenge của Circle → lưu lịch DCA mỗi giờ.

## 7. Nó tự kiểm toán — on-chain

Git thôi chỉ đáng tin bằng đúng độ đáng tin của repo. Nên sau mỗi lần chạy, agent băm sổ cái đã commit và ghi `keccak256(data/ledger.json)` vào [`AuraAttestation.sol`](https://testnet.arcscan.app/address/0x4948c662630c7dE36BD59089085850c00996F661), một hợp đồng chuyên dụng trên Arc Testnet mà **chỉ ví của agent mới được ghi**.

Bất kỳ ai cũng có thể tính lại hash từ repo công khai và đối chiếu với `latestHash` on-chain — sổ sách off-chain trở nên **chống-giả-mạo có thể phát hiện on-chain**. Cron đã ghi **14+ attestation mà không cần con người**. Hợp đồng **không giữ tiền và không chạm số dư nào** — một lỗi ở đó cũng không thể di chuyển một token.

Tự kiểm chứng, chỉ đọc: `npm run verify-attest`.

## 8. Hiện trạng trung thực — và vì sao đó là điểm mạnh

Mở [`data/history.json`](data/history.json) bạn sẽ thấy hàng loạt dòng `error_swap_failed`. Nói thẳng:

> `USDC → cirBTC` trả về *"No route available"* ở **mọi** lần thử trong 14 ngày lịch khác nhau. Đây là **sự cố thanh khoản trên Arc Testnet, không phải lỗi của agent** — `npm run check-routes` chứng minh nó chỉ cô lập ở cirBTC, tài sản biến động duy nhất Arc có (chuỗi này thuần stablecoin, đến cả token gas cũng là USDC).

**Agent đã xử lý đúng như ta mong muốn.** Nó nhận ra các lỗi là *có tính cấu trúc, không phải nhất thời*, ghi lý do đó vào [reflections](data/reflections.json) của chính nó, giảm tần suất thăm dò để ngừng đốt phí, và **giữ lại tiền để bảo toàn vốn** suốt cả đợt sự cố — không người giám sát. **Biết khi nào *không* hành động là nửa khó hơn của một agent quản tiền tự động.**

Thay vì che đậy, chúng tôi biến **token đích thành lựa chọn của từng người dùng**: chọn EURC thì lệnh mua của bạn khớp live ngay hôm nay (đã chứng minh on-chain, mỗi giờ); để nguyên cirBTC thì agent chờ qua đợt sự cố. Cả hai nửa chạy song song, từ cùng một bộ lập lịch, trong cùng những lần chạy.

**Con bug chứng minh luận điểm:** hàm `dayCount()` của chính chúng tôi từng trả về số *lần chạy*, không phải số ngày khác nhau — nên agent tưởng nó đang ở "ngày 21" sau một tuần và reflections thổi phồng độ dài sự cố ~3 lần. Một agent suy luận từ một con số bị dán nhãn sai thì **sai một cách tự tin, mà đầu ra chẳng có gì trông hỏng cả** — đó chính là toàn bộ lý do phải giữ quyền-quyết-định-tiền trong code đã test, chứ không phải trong mô hình. Đã sửa và có regression test.

## 9. x402 — agent tự trả tiền cho đầu vào của chính nó

Ngoài việc *chi* USDC để tích lũy, agent có thể **trả theo từng lần gọi** cho một đầu vào có tính phí qua **x402** (HTTP 402 "Payment Required") — một nguyên thủy tiền tệ thực sự khác biệt, và gần với ý nghĩa của "programmable money" hơn.

Request không kèm thanh toán nhận về `402` + yêu cầu thanh toán; lần thử lại mang theo một ủy quyền USDC đã ký (**EIP-3009 `transferWithAuthorization`**) được **xác minh** bằng mật mã và tài nguyên được mở khóa.

```bash
npm run x402-demo   # một lệnh, không cần cài đặt, không cần khóa
```

**Phạm vi trung thực:** thanh toán được ký và xác minh, nhưng **việc settle bị khóa** — cùng tinh thần "paper-fill" trung thực đã áp dụng cho sự cố cirBTC. Cấu trúc đã ký chính xác là thứ một facilitator sẽ settle. Đây là **module cộng thêm** (`src/x402/`, 12 test) không hề chạm vào pipeline DCA.

## 10. Ngăn xếp công nghệ & kiến trúc an toàn

- **TypeScript / Node.js**, chạy trực tiếp bằng `tsx` (không bước build)
- **Anthropic Claude** — bộ máy quyết định, qua ép tool-use + validate zod
- **Circle Swap Kit** + **Developer-Controlled Wallets** (agent) + **User-Controlled Wallets** (onboard Google/email)
- **Arc Testnet** — EVM L1 thuần stablecoin của Circle (trả gas bằng USDC)
- **Solidity** — `AuraAttestation.sol`, neo kiểm toán on-chain không giữ tiền
- **GitHub Actions** cron — lập lịch, secret, và nhật ký kiểm toán commit-back. Không cần server.
- **Vitest** — **65 unit test** trên các đường quan trọng về an toàn: guardrail `clampDecision()`, phân phối gộp theo tỷ lệ, biên định cỡ smart, hash kiểm toán on-chain, số học ngày sự cố/chiến dịch
- **Vercel** serverless cho các hành động đã ký của dashboard
- **Dashboard một file** (`docs/index.html`) — khám phá ví EIP-6963, ký EIP-191, EN/VI, sáng/tối

**Hai công tắc độc lập** bảo vệ giao dịch thật: `DRY_RUN` và `LIVE_TRADING_ENABLED`. Chừng nào chưa bật cả hai, mọi lần chạy mặc định là dry run.

## 11. Điều làm nó nổi bật

- **Tuyên bố khó được chứng minh, không phải khẳng định suông** — "nhiều người, một swap, chia theo tỷ lệ" đã chạy on-chain, không giám sát, hai lần.
- **Thực thi thật, kiểm chứng được** — không phải video demo. Swap thật, phân phối theo từng người thật, các lần chạy CI xanh ai cũng kiểm tra được.
- **Kiến trúc an toàn** — sự phân tách LLM-đề-xuất / code-quyết-định, thực thi bằng một hàm thuần đã test cộng cổng hai công tắc.
- **Tự kiểm toán on-chain** — 14+ attestation do cron ghi, không con người tham gia.
- **Tự động thực sự** — tự host trên CI miễn phí, suy luận từ chính lịch sử chạy của mình, báo Telegram mỗi lần chạy.
- **Tích hợp Circle sâu — cả hai loại ví** — agent trên Developer-Controlled Wallet, người dùng onboard Google → User-Controlled Wallet trên Arc.

## 12. Hướng phát triển tiếp

- **Settle on-chain cho Circle Nanopayments (x402)** — lát cắt đầu đã ship (chỉ xác minh); đưa lên settle on-chain qua Circle Gateway là bước kế, và cấu trúc đã ký sẵn sàng để settle.
- **Chia nhiều tài sản biến động do Claude quyết định** — lựa chọn token theo người dùng đã ship; chia đa tài sản mở khóa ngày Arc kết nối hơn một loại.
- **Bảng P&L / giá vốn live** — biểu đồ khớp lệnh theo token đã vẽ tỷ giá thật trả mỗi lần chạy.
- **Rà soát sẵn sàng cho mainnet** khi Arc mainnet ra mắt.

---

### Thương hiệu & an toàn

**Aura DCA là dự án độc lập xây trên Arc Network — không liên kết, không được chứng thực, và không phải sản phẩm của Circle.** Tên và logo là của riêng Aura; Arc chỉ được nhắc theo nghĩa sự thật đã được phép. **Chỉ testnet** — tiền là token faucet vô giá trị; giao dịch thật cần hai công tắc rõ ràng. Guardrail được thực thi trong code, không phải bởi mô hình.
