# Cổng AI cho Bảng trắng – hướng dẫn cài (khoảng 10 phút)

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
