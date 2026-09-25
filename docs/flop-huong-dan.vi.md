# Aura DCA — Agent DCA tự động trên Arc Network (hướng dẫn tiếng Việt)

> Đóng góp cộng đồng cho hệ sinh thái **FLOP / Technocore**.
> **DID:** `did:key:z6MkiCxCfTP6gHmWrJvPgF4UtxYL4upzry6hTAs6g1ni2C8g`
> **Repo:** https://github.com/thanhphuc85/technocore-crypto-agent

Bài này giới thiệu một **agent DCA tự vận hành** chạy trên **Arc Testnet**: mỗi
chu kỳ, agent hỏi **Claude** nên mua bao nhiêu, rồi **code (không phải LLM)** mới
là bên quyết định con số thực sự được chi. Không server, không người bấm nút,
khoá ký do Circle custody — không private key nào nằm trong repo.

## 1. Ý tưởng cốt lõi

Mâu thuẫn của một bot tiền tự động: bạn muốn sự linh hoạt của LLM, nhưng **không
thể để LLM là bên quyết định cuối cùng chi bao nhiêu**. Aura DCA giải quyết bằng
một ranh giới cứng:

| | Claude (agent) | `clampDecision()` (code) |
|---|---|---|
| Vai trò | **Đề xuất** số tiền + lý do | **Quyết định** số thực sự swap |
| Tin cậy | Không bao giờ nắm con số cuối | Bên quyền lực duy nhất; hàm thuần; có unit test |

Mỗi lần chạy đều ghi lại **ràng buộc nào** đã chốt kết quả (`boundBy`), nên lịch
sử luôn minh bạch là do phán đoán của Claude hay do guardrail cứng.

## 2. Luồng một chu kỳ

1. Đọc số dư USDC của ví (Circle Developer-Controlled Wallet) trên Arc Testnet.
2. Gọi **Claude** để đề xuất mức chi hôm nay, dựa trên ngân sách còn lại, số ngày,
   và lịch sử giao dịch.
3. **Clamp** đề xuất đó theo guardrail cứng trong code (trần/ngày, dự trữ tối
   thiểu, kích thước swap tối thiểu, ngân sách chiến dịch).
4. Gom user theo token họ chọn, thực hiện **một swap USDC → token cho mỗi nhóm**
   qua **Circle Swap Kit**, chia pro-rata.
5. Ghi một dòng vào `data/history.json` và commit ngược lại repo — audit trail
   công khai theo thời gian.

## 3. Chạy thử (dry run — không tốn phí)

```bash
npm install
cp .env.example .env
# điền CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, KIT_KEY, ANTHROPIC_API_KEY

npm run create-wallet   # tạo ví bot trên Arc Testnet
# nạp testnet USDC tại https://faucet.circle.com (chọn Arc Testnet)

npm run typecheck && npm test
DRY_RUN=true npm start   # chạy thật phần quyết định của Claude, bỏ qua swap
```

## 4. Tham gia FLOP testnet bằng DID (module `src/flop/`)

Repo có sẵn module **`src/flop/`** cho faucet testnet của FLOP và cơ chế
auto-spend — **tắt mặc định, không đụng vào luồng tiền DCA**. Khi FLOP công bố
spec (endpoint faucet + scheme xác thực DID), chỉ cần:

1. Dùng **một DID duy nhất** cho mọi hoạt động — ở đây là
   `did:key:z6MkiCxCfTP6gHmWrJvPgF4UtxYL4upzry6hTAs6g1ni2C8g`. Đừng sinh thêm
   khoá/DID khác.
2. Điền `FLOP_FAUCET_URL`, `FLOP_DID`, `FLOP_DID_ADDRESS` trong `.env`.
3. Viết hàm ký proof DID theo scheme của FLOP.
4. Cho đề xuất chi tiêu chạy qua `clampDecision()` rồi mới swap — guardrail vẫn là
   bên quyết định duy nhất.

Thử offline (không cần khoá, không gọi mạng):

```bash
npm run flop-demo
```

> ⚠️ **Cảnh giác lừa đảo airdrop:** chỉ dùng faucet **chính thức** của FLOP khi
> spec được công bố. Không bao giờ nhập seed phrase / private key vào các link lạ
> kiểu "connect wallet để tăng cơ hội airdrop".

## 5. An toàn

- **Chỉ testnet.** Không có USDC/token mainnet nào bị rủi ro.
- Ví do **Circle custody** — không commit `.env` hay `CIRCLE_ENTITY_SECRET`.
- `clampDecision()` là bên duy nhất quyết định số tiền chi; output của Claude luôn
  chỉ là đề xuất.

---

*Aura DCA là dự án độc lập xây trên Arc Network, không liên kết hay được bảo trợ
bởi Circle. Mọi góp ý: mở issue tại repo ở trên.*
