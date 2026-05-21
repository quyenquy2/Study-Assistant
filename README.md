# 🎓 Study Assistant - Chrome Extension

Extension Chrome tra cứu đáp án bài tập, câu hỏi học tập bằng AI (Claude / OpenAI / Gemini).

## ✨ Tính năng

- **4 cách kích hoạt** linh hoạt:
  - Bôi đen text → click nút floating xuất hiện cạnh con trỏ
  - Right-click → "Tra cứu với Study Assistant"
  - Click icon extension trên thanh công cụ → popup
  - Phím tắt `Ctrl+Shift+Y` (tra cứu selection) hoặc `Ctrl+Shift+U` (mở popup)
- **3 AI provider**: Gemini (free), Claude, OpenAI - chọn trong Options
- **Lịch sử** 50 câu hỏi gần nhất
- **Popup nổi** kéo thả được, copy đáp án nhanh

## 🚀 Cài đặt

### Bước 1: Tạo icons
- Mở file `icons/generate-icons.html` trong trình duyệt
- Click **"Tải tất cả 3 icons"**
- Di chuyển 3 file `icon16.png`, `icon48.png`, `icon128.png` vào thư mục `icons/`

### Bước 2: Load extension
1. Mở Chrome → `chrome://extensions`
2. Bật **Developer mode** (góc phải trên)
3. Click **"Load unpacked"** → chọn thư mục `study-assistant-extension`
4. Trang Options sẽ tự mở lần đầu

### Bước 3: Cấu hình API key
Chọn 1 trong 3 provider:

| Provider | Lấy API key tại | Ghi chú |
|----------|----------------|---------|
| **Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Có gói miễn phí, khuyên dùng để bắt đầu |
| **Claude** | [console.anthropic.com](https://console.anthropic.com/settings/keys) | Trả lời chi tiết, sâu |
| **OpenAI** | [platform.openai.com](https://platform.openai.com/api-keys) | GPT-4o-mini rẻ |

Dán key vào Options → bấm **"Test kết nối"** để xác nhận hoạt động.

## 📖 Cách dùng

**Tình huống 1: Đang đọc bài tập trên web**
- Bôi đen câu hỏi → click nút 🎓 nổi lên cạnh chuột → đáp án hiện trong popup ngay tại trang

**Tình huống 2: Tự gõ câu hỏi**
- Click icon extension trên thanh công cụ Chrome → nhập câu hỏi vào popup → `Ctrl+Enter`

**Tình huống 3: Right-click**
- Bôi đen text → chuột phải → **"Tra cứu với Study Assistant"**

**Tình huống 4: Phím tắt**
- Bôi đen text rồi nhấn `Ctrl+Shift+Y`

### Nếu phím tắt không chạy

- Mở `chrome://extensions/shortcuts`
- Kiểm tra xem shortcut có đang bị trống hoặc bị trùng với shortcut khác không
- Trong trang **Options** của extension, mục **Phím tắt** sẽ hiển thị shortcut nào đang thực sự được Chrome gán

## 🗂 Cấu trúc

```
study-assistant-extension/
├── manifest.json           # Manifest V3
├── icons/
│   ├── generate-icons.html # Tool tạo icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── background.js       # Service worker
    ├── api.js              # Client gọi AI
    ├── content.js          # Inject vào trang web
    ├── content.css
    ├── popup.html / .js / .css   # Popup khi click icon
    └── options.html / .js / .css # Trang cài đặt
```

## 🔒 Quyền riêng tư

- API key lưu trong `chrome.storage.sync` (Google sync giữa các thiết bị của bạn).
- Lịch sử lưu trong `chrome.storage.local` (chỉ trên máy này).
- Câu hỏi chỉ được gửi đến provider AI bạn chọn, không qua bất kỳ máy chủ trung gian nào khác.

## 🛠 Tuỳ chỉnh prompt

Trong Options → mục "Prompt hệ thống" bạn có thể đổi cách AI trả lời, ví dụ:

```
Bạn là gia sư môn Toán cho học sinh THPT. Hãy:
- Đưa đáp án ngắn gọn
- Vẽ sơ đồ tư duy bằng text nếu có thể
- Trích dẫn định lý liên quan
```

## 📄 License

MIT
