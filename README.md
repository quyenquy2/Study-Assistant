# Study Assistant - Chrome Extension

Extension Chrome tra cứu đáp án bài tập, câu hỏi học tập bằng AI qua Gemini, Claude, OpenAI hoặc custom gateway.

## Tính năng

- **2 chức năng tra cứu**
  - Bôi đen đoạn text trên trang web rồi tra cứu.
  - Chụp một vùng màn hình rồi tra cứu nội dung trong ảnh.
- **2 mode trả lời**
  - **Detail**: hiện popup nổi trên trang và trả lời theo prompt hệ thống đã cấu hình.
  - **Quick**: chỉ hiện toast nhỏ ở góc màn hình với đáp án ngắn.
- Hỗ trợ Gemini, Claude, OpenAI và Custom Gateway.
- Lưu lịch sử 50 câu hỏi gần nhất.

## Cài đặt

### Bước 1: Tạo icons

- Mở `icons/generate-icons.html` trong trình duyệt.
- Click **"Tải tất cả 3 icons"**.
- Di chuyển `icon16.png`, `icon48.png`, `icon128.png` vào thư mục `icons/`.

### Bước 2: Load extension

1. Mở Chrome -> `chrome://extensions`.
2. Bật **Developer mode**.
3. Click **Load unpacked** rồi chọn thư mục dự án.
4. Trang Options sẽ tự mở lần đầu.

### Bước 3: Cấu hình API key

Chọn provider trong Options, dán API key, chọn mode `Detail` hoặc `Quick`, rồi bấm **Test kết nối**.

| Provider | Lấy API key tại | Ghi chú |
| --- | --- | --- |
| Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Có gói miễn phí |
| Claude | [console.anthropic.com](https://console.anthropic.com/settings/keys) | Trả lời chi tiết |
| OpenAI | [platform.openai.com](https://platform.openai.com/api-keys) | Phổ biến |

## Cách dùng

- **Tra cứu đoạn bôi đen**: bôi đen text rồi click nút nổi, dùng context menu, hoặc nhấn `Ctrl+Shift+Y`.
- **Chụp vùng màn hình**: click nút camera trong popup, dùng context menu, hoặc nhấn `Ctrl+Shift+S`.
- **Đổi mode**: chọn `Detail` hoặc `Quick` trong popup hoặc Options. Mode áp dụng cho cả hai chức năng trên.

Nếu phím tắt không chạy, mở `chrome://extensions/shortcuts` để kiểm tra shortcut có bị trùng hay chưa được gán không.

## Cấu trúc

```text
study-assistant-extension/
├── manifest.json
├── icons/
│   ├── generate-icons.html
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── background.js
    ├── api.js
    ├── content.js
    ├── content.css
    ├── popup.html / .js / .css
    └── options.html / .js / .css
```

## Quyền riêng tư

- API key lưu trong `chrome.storage.sync`.
- Lịch sử lưu trong `chrome.storage.local`.
- Câu hỏi chỉ được gửi đến provider AI đã chọn, không qua server trung gian của extension.

## Tùy chỉnh prompt

Trong Options, mục **Prompt hệ thống** cho phép đổi cách AI trả lời. Mode `Detail` dùng prompt này để hiển thị kết quả đầy đủ; mode `Quick` vẫn ưu tiên đáp án ngắn để phù hợp toast.

## License

MIT
