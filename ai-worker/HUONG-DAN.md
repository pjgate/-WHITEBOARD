# Cổng AI cho Bảng trắng

Có 2 cách dựng cổng AI. **Đang dùng: Google Apps Script** (cách A). Cách B (Cloudflare Worker) giữ lại để tham khảo:
gọi Gemini từ Cloudflare hay bị lỗi "User location is not supported" vì Cloudflare có lúc chạy ở Hồng Kông.

## Cách A – Google Apps Script (khuyên dùng, miễn phí, ~5 phút)
1. Vào https://script.google.com → **New project** (Dự án mới). Đặt tên `Bang trang AI`.
2. Xóa code mẫu trong `Code.gs`, dán toàn bộ tệp `ai-worker/apps-script.gs` → bấm 💾 Lưu.
3. Bấm ⚙ **Project Settings** → kéo xuống **Script Properties** → **Add script property**, thêm:
   - `GEMINI_API_KEY` = khóa `AIza…` (aistudio.google.com/apikey)
   - `ALLOWED_EMAILS` = email được dùng AI, cách nhau bằng dấu phẩy; ghi `@truongthang.vn` để cho cả tên miền
   - (tùy chọn) `MODEL` = tên model, mặc định `gemini-3.5-flash-lite`
   → **Save script properties**.
4. **Deploy** → **New deployment** → bánh răng chọn **Web app** →
   *Execute as*: **Me**, *Who has access*: **Anyone** → **Deploy**.
5. Google hỏi cấp quyền: **Authorize access** → chọn tài khoản → nếu hiện "Google hasn't verified this app": **Advanced** → **Go to Bang trang AI (unsafe)** → **Allow**.
   (Đây là script của chính bạn; quyền xin là "kết nối dịch vụ bên ngoài" để gọi Gemini.)
6. Sao chép **Web app URL** (dạng `https://script.google.com/macros/s/…/exec`) → gửi Claude hoặc điền vào `aiUrl` trong `index.html`.
7. Kiểm tra: mở URL đó trên trình duyệt, thấy `"configured":true` là đúng.

Sửa danh sách email / model: vào Project Settings → Script Properties, sửa là có hiệu lực ngay (không cần Deploy lại).
Sửa **code** thì phải Deploy → **Manage deployments** → ✏ → Version: **New version** → Deploy (giữ nguyên URL).

### Bật "đăng nhập nhiều ngày" (dùng chung cổng Apps Script này)
Bình thường Google chỉ cho app trên trình duyệt một vé đăng nhập ~1 giờ. Khi cổng có mã bí mật của OAuth Client,
app nhận thêm **refresh token** và tự lấy vé mới ở chế độ nền, không bật cửa sổ Google.
1. Dán lại toàn bộ `ai-worker/apps-script.gs` mới vào `Code.gs` → 💾 Lưu.
2. Lấy mã bí mật: https://console.cloud.google.com (tài khoản **duli3ucanhan**, đúng dự án có Client ID `815013146430-…`)
   → **APIs & Services → Credentials** (hoặc Google Auth Platform → **Clients**) → bấm vào OAuth client của Bảng trắng
   → mục **Client secrets**. Google chỉ hiện mã đầy đủ lúc vừa tạo: nếu không xem được thì bấm **Add secret**
   rồi sao chép ngay mã `GOCSPX-…` mới tạo. (Mã cũ vẫn dùng được, không cần xóa.)
3. Project Settings → Script Properties → thêm `GOOGLE_CLIENT_SECRET` = mã `GOCSPX-…` → Save.
4. Deploy → **Manage deployments** → ✏ → Version: **New version** → Deploy (giữ nguyên URL).
5. Kiểm tra: mở URL `…/exec` thấy `"auth":true`.
6. Trên Bảng trắng: **Đăng xuất rồi đăng nhập lại 1 lần** (Google hiện màn hình đồng ý quyền → Cho phép). Từ đó app tự gia hạn.

Lưu ý:
- App OAuth đang ở chế độ **Testing** → Google cho refresh token sống tối đa **7 ngày**, sau đó phải đăng nhập lại 1 lần.
  Muốn lâu hơn: Google Auth Platform → **Audience** → **Publish app** (In production). Khi đó không cần danh sách Test users nữa
  (ai có tài khoản Google cũng bấm đăng nhập được, nhưng vẫn chỉ xem được dự án được chia sẻ trên Drive); vì app chưa được
  Google xác minh nên màn hình đăng nhập sẽ có cảnh báo "Google hasn't verified this app" (bấm Advanced → tiếp tục) và giới hạn 100 người dùng.
- Mã bí mật chỉ nằm trong Script Properties, không đưa vào `index.html`. Refresh token lưu trên máy người dùng (localStorage `wb-grt`);
  bấm **Đăng xuất** sẽ xóa nó. Nếu lộ mã bí mật: vào Client secrets xóa mã đó, tạo mã mới và cập nhật Script Properties.

---

## Cách B – Cloudflare Worker

Cổng AI là một chương trình nhỏ chạy miễn phí trên Cloudflare. Nó giữ khóa API Gemini (không lộ ra trang web),
và chỉ cho người đã đăng nhập Google trên Bảng trắng (có email trong danh sách) dùng AI.

```
Bảng trắng (GitHub Pages)  →  Cổng AI (Cloudflare Worker, giữ khóa)  →  Gemini API
     gửi kèm đăng nhập Google       kiểm tra email được phép
```

## Bước 1 – Lấy khóa API Gemini
1. Vào https://aistudio.google.com/apikey, đăng nhập Google (nên dùng tài khoản duli3ucanhan hoặc tài khoản quản lý).
2. Bấm **Create API key** → chọn (hoặc tạo) một dự án Google Cloud → sao chép khóa (bắt đầu bằng `AIza…`).
3. Gói miễn phí có giới hạn số lượt mỗi phút/mỗi ngày; nếu nhóm dùng nhiều có thể bật thanh toán (Billing) trong AI Studio.
   Lưu ý: theo điều khoản của Google, dữ liệu gửi qua gói miễn phí có thể được Google dùng để cải thiện sản phẩm. Nếu bản vẽ/tài liệu nhạy cảm, nên bật Billing (gói trả phí không dùng dữ liệu theo cách đó) — xem điều khoản hiện hành trên trang AI Studio.

## Bước 2 – Tạo Worker trên Cloudflare
1. Vào https://dash.cloudflare.com, đăng ký tài khoản miễn phí.
2. Menu trái: **Compute (Workers)** → **Workers & Pages** → **Create** → **Start with Hello World** (hoặc "Create Worker").
3. Đặt tên `bang-trang-ai` → **Deploy**.
4. Bấm **Edit code**. Xóa hết code mẫu, dán toàn bộ nội dung tệp
   https://raw.githubusercontent.com/sangs8516/-WHITEBOARD/main/ai-worker/worker.js
   rồi bấm **Deploy**.

## Bước 3 – Khai báo khóa và danh sách người dùng
Trong Worker vừa tạo: **Settings** → **Variables and Secrets** → **Add**:

| Tên | Loại | Giá trị |
|---|---|---|
| `GEMINI_API_KEY` | **Secret** | khóa `AIza…` ở bước 1 |
| `ALLOWED_EMAILS` | Text | các email được dùng AI, cách nhau bằng dấu phẩy, vd. `sangkt0510@gmail.com, ban@gmail.com` |
| `GOOGLE_CLIENT_ID` | Text | `815013146430-cjh67feg7j7k5asaq72qrkrn3i70048r.apps.googleusercontent.com` |

Tùy chọn: `MODEL` (mặc định `gemini-flash-latest` = luôn dùng bản Flash mới nhất; có thể ghi cụ thể như `gemini-3.6-flash`), `MAX_TOKENS` (mặc định 8192).
(Muốn đổi sang Claude sau này: xóa `GEMINI_API_KEY`, thêm `ANTHROPIC_API_KEY`.)
Bấm **Deploy/Save** sau khi thêm.

## Bước 4 – Kiểm tra và gắn vào app
1. Mở địa chỉ Worker (dạng `https://bang-trang-ai.<tên-bạn>.workers.dev`). Thấy `"provider":"gemini"` và `"configured":true` là đúng.
2. Gửi địa chỉ đó cho Claude, hoặc tự điền vào `index.html`: `aiUrl: 'https://bang-trang-ai.<tên-bạn>.workers.dev'`.
3. Mở Bảng trắng, vào một dự án → nút **✦ AI** trên thanh trên cùng.

## Dùng AI trên bảng
- AI luôn đọc **tất cả ghi chú** của dự án đang mở.
- Đánh dấu **Gửi kèm ảnh/PDF đang xem**: AI đọc thêm các ảnh/trang PDF đang chọn, hoặc tối đa 4 cái đang hiện giữa màn hình.
- Nút nhanh: *Tóm tắt ghi chú*, *Việc cần làm*, *Đọc ảnh/PDF đang xem*.
- **＋ Thêm vào bảng**: biến câu trả lời thành ghi chú (màu tím) mang tên bạn. Nếu AI tách bằng dòng `---` thì mỗi đoạn thành một ghi chú.

## Thêm/bớt người dùng AI
Sửa biến `ALLOWED_EMAILS` trong Cloudflare → Save. Không cần sửa app. (Người đó vẫn phải đăng nhập được app, tức có trong Test users của Google.)

## Lỗi thường gặp
- *"chưa được phép dùng AI"*: email chưa có trong `ALLOWED_EMAILS`.
- *"Khóa Gemini sai"*: kiểm tra lại `GEMINI_API_KEY`.
- *"hết lượt miễn phí/hạn mức"*: chờ vài phút, hoặc bật Billing trong AI Studio.
- *"Không tìm thấy model"*: sửa hoặc xóa biến `MODEL`.
- *"Không kết nối được cổng AI"*: sai `aiUrl` hoặc Worker chưa Deploy.
- Gói miễn phí của Cloudflare giới hạn thời gian xử lý mỗi lượt; nếu gửi nhiều ảnh lớn hay lỗi, chọn ít ảnh hơn.
