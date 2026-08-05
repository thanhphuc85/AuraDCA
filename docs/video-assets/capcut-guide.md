# Aura DCA — CapCut assembly guide / Hướng dẫn dựng CapCut

Everything you need to build the pitch video is in this folder (`docs/video-assets/`).
Bạn chỉ cần import và ghép — không phải tự thiết kế lại gì.

## Files in this folder / Các file trong thư mục

| File | Dùng để làm gì |
|---|---|
| `slide-01.png` … `slide-12.png` | 12 ảnh nền 1920×1080, mỗi ảnh một slide — kéo lần lượt vào timeline |
| `narration-en.txt` | Lời thoại tiếng Anh, chia theo slide — dán vào Text-to-Speech hoặc thu giọng |
| `narration-vi.txt` | Lời thoại tiếng Việt, chia theo slide |
| `captions-en.srt` | Phụ đề tiếng Anh đã canh giờ — import làm caption track |
| `captions-vi.srt` | Phụ đề tiếng Việt đã canh giờ |

> Cần bản gốc để chỉnh chữ/màu? Mở `docs/pitch-deck.html`. Muốn xuất lại ảnh sau khi sửa: xem mục "Re-export slides" cuối file.

---

## Cách dựng nhanh trong CapCut (khoảng 15 phút)

### 1. Tạo dự án 1080p
- Mở CapCut → **New project**. Tỷ lệ **16:9**, độ phân giải **1080p**.

### 2. Kéo 12 ảnh slide vào timeline
- Import `slide-01.png` → `slide-12.png` vào **Media**, kéo lần lượt lên track video theo đúng thứ tự.
- Đặt độ dài mỗi ảnh theo bảng timeline bên dưới (hoặc để khớp với giọng đọc ở bước 4).

### 3. Chuyển cảnh (transition)
- Giữa các slide: dùng **Fade** hoặc **Dissolve**, thời lượng **0.3–0.5s**.
- Riêng vào Slide 5 (bằng chứng on-chain) và Slide 12 (kết): có thể để **cut thẳng** cho dứt khoát.

### 4. Lời thoại — chọn 1 trong 2 cách
- **Text-to-Speech (nhanh):** với mỗi slide, thêm 1 text box (có thể để ngoài khung hình), dán đoạn tương ứng từ `narration-vi.txt` (hoặc `-en`), rồi **Text → Text to speech** → chọn giọng. CapCut sẽ tạo audio; kéo độ dài ảnh cho khớp.
- **Thu giọng thật (hay hơn):** đọc theo `narration-*.txt`, thu bằng **Audio → Record**. Nhịp gợi ý ~150 từ/phút, ngắt nửa giây sau mỗi chuyển slide.

### 5. Phụ đề
- **Cách A — import SRT:** **Text → Captions/Subtitles → Import** → chọn `captions-vi.srt` (hoặc `-en`).
- **Cách B — auto:** nếu đã có voiceover, dùng **Auto captions** để CapCut tự nhận giọng thành phụ đề (rồi đối chiếu lại với file `.srt`).

### 6. Nhạc nền
- Thêm một track nhạc **ambient / minimal tech** nhẹ, âm lượng **−18 đến −22 dB** để không lấn giọng.
- Fade in 1s ở đầu, fade out 2s ở cuối (Slide 12).

### 7. Cảnh cắt video thật (tùy chọn, tăng độ tin cậy)
Thay ảnh tĩnh bằng clip quay màn hình ở 2 chỗ:
- **Slide 5:** quay trang ArcScan của giao dịch swap gộp — chèn đè lên ảnh slide-05:
  `https://testnet.arcscan.app/tx/0xd8a19fef1527ed91122ba29ec1ea9a845be1a7e3f3005450252f143956c07a19`
- **Slide 12:** quay nhanh dashboard `https://aura-dca.xyz` (cuộn treasury + lịch sử).

### 8. Xuất
- **Export** → 1080p, 30fps, chất lượng **High**. Bitrate ≥ 8 Mbps.

---

## Timeline / Bảng thời lượng

| Slide | Nội dung | Bắt đầu | Dài (EN) | Cắt cảnh |
|---|---|---|---|---|
| 01 | Tiêu đề | 0:00 | 22s | ảnh |
| 02 | Vấn đề | 0:22 | 23s | ảnh |
| 03 | Giải pháp (đề xuất/quyết định) | 0:45 | 27s | ảnh |
| 04 | Nhiều người, một swap | 1:12 | 20s | ảnh |
| 05 | Bằng chứng on-chain | 1:32 | 33s | **→ ArcScan** |
| 06 | Phi lưu ký, 2 loại ví | 2:05 | 23s | ảnh (tùy: login Google) |
| 07 | Tự kiểm toán on-chain | 2:28 | 20s | ảnh |
| 08 | Hiện trạng trung thực | 2:48 | 24s | ảnh (tùy: history.json) |
| 09 | x402 | 3:12 | 18s | ảnh (tùy: terminal demo) |
| 10 | Tech & an toàn | 3:30 | 15s | ảnh |
| 11 | Điểm nổi bật | 3:45 | 15s | ảnh |
| 12 | Kết | 4:00 | ~25s | **→ Dashboard** |

**Tổng:** ~4 phút 25 giây (EN). Bản VI dài hơn ~10–15%, tổng ~4:45 — cứ kéo ảnh cho khớp giọng.

> Muốn video 2 phút? Bỏ slide 7 và 9, rút gọn lời thoại slide 3, 8 → còn ~2:15.

---

## Re-export slides (nếu sửa deck)

Sau khi sửa `docs/pitch-deck.html`, chạy lại lệnh này để xuất lại 12 ảnh (dùng Chrome headless):

```bash
CHROME="/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
OUT="/c/arcdca/docs/video-assets"
URL="file:///C:/arcdca/docs/pitch-deck.html?export"
for n in $(seq 1 12); do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1920,1080 --virtual-time-budget=2500 \
    --screenshot="$(printf "%s/slide-%02d.png" "$OUT" "$n")" "${URL}#${n}"
done
```

Deep-link từng slide để xem trực tiếp: mở `pitch-deck.html#5` là ra slide 5.
