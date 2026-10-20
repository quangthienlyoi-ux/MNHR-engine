# MNHR-engine
## TỔNG QUAN (3/10/2026)
Đây là một dự án Mã Nguồn Mở để tạo một công cụ (tools) engine (Low Code) giúp làm Game 2D
- Được Tạo Bởi AI: Deepseek
- Có sẵn các tính năng cơ bản của một Engine
- Project ban đầu tên là MiniEngine (Deepseek tự đặt tên)
- Lưu Ý: Bản phát hành hiện tại là bản Beta - Chưa phải chính thức.


Logs: Dự Án Bị Tạm Dừng Vì Lý Do: Lười, dự án sẽ được restart vào thời gian tới (5/10/2026)

Logs V7 (20/10/2026):

# MNHR-engine v7 (Alpha)



## 👋 Giới Thiệu Thật Lòng
MNHR-engine là một game engine 2D đơn giản, tự chứa (self-contained), chỉ cần 1 file HTML + JS là chạy được. 
Không framework, không server, không cài đặt phức tạp. Phù hợp cho dev nghiệp dư, học sinh, hoặc ai lười setup môi trường.

**Lịch sử hình thành:**
- **v1-v5:** Do Deepseek viết khung cốt lõi (MiniRuntime, Physics, Events). Code sạch nhưng hay bị tràn context.
- **v6:** Tác giả (Meonehero) tự thêm tính năng, fix bug, design UI Cyberpunk/Brutalist. Bắt đầu có "hồn".
- **v7:** Claude Sonnet refactor toàn bộ, migrate sang OPFS, fix bug chí mạng, chuẩn hóa kiến trúc. Engine chính thức thoát kiếp "prototype 200 dòng".

## ✨ Tính Năng (Những Gì Còn Hoạt Động Tốt)
- **Zero Dependency:** Vanilla JS thuần. Mở Notepad++ là sửa được.
- **Visual Editor:** Kéo thả nhân vật/khối, chỉnh hitbox trực quan, cắt spritesheet ngay trên web.
- **Hệ thống Biến (Events):** Trigger → Delay → Action. Lập trình gameplay không cần code (nhưng logic đôi khi còn ngây thơ).
- **Lưu trữ OPFS:** Không lo tràn localStorage. Lưu ảnh nặng, project lớn thoải mái (đã test với ảnh >1MB).
- **Export ZIP độc lập:** Xuất game ra file ZIP chứa index.html + assets/. Gửi qua Zalo là chơi được ngay.
- **UI Brutalist Vàng Cam:** Vuông vức, border rõ rệt, palette đen-vàng cam công nghiệp. Không bo tròn giả tạo. *Gu thẩm mỹ này do tác giả ép AI tuân theo.*

## ⚠️ Cảnh Báo 
- Đây là bản **ALPHA**. Expect bugs, breaking changes, và những tính năng đang trong giai đoạn "thử nghiệm xem có sập không".
- Logic physics còn đơn giản (AABB thuần), chưa có sweep collision, one-way platform, hay moving platform.
- Bot AI khá ngu: Chỉ biết patrol/chase/bắn đạn. Chưa có pathfinding, né vực, hay state machine phức tạp.
- AudioContext tạo mới mỗi lần bắn đạn (chưa fix triệt để ở v7). Mobile browser có thể chặn sau vài phút.
- Custom JS injection trong exporter = rủi ro bảo mật. Đừng chạy code lạ nếu không tin tưởng nguồn.

## ️ Tech Stack (Những Gì Đang Dùng)
- **Runtime:** Vanilla JS ES6+ (IIFE pattern, no modules)
- **Storage:** OPFS > IndexedDB > localStorage (fallback chain)
- **Graphics:** HTML5 Canvas 2D API (no WebGL, no PixiJS)
- **Physics:** Custom AABB collision + deepest penetration resolution
- **AI Support:** Refactored by Claude Sonnet 3.5/4, inspired by Deepseek v1-v5, annoyed by Qwen's color suggestions

##  Bắt Đầu Nhanh Mà Không Cần Tải Engine Về
1. Truy cập [GitHub Pages](https://quangthienlyoi-ux.github.io/MNHR-engine/)
2. Thêm nhân vật/khối, import ảnh, chỉnh hitbox.
3. Bấm ▶ Chạy để test, hoặc 📦 Xuất game để tải về máy.
4. Nếu game crash, hãy kiểm tra console F12 trước khi chửi tác giả.

## 🤝 Đóng Góp / Feedback
Mọi issue, pull request, hay sekadar "cafe virtual" đều được chào đón!
*Lưu ý: Tác giả là học sinh lớp 6, phản hồi có thể chậm vào giờ học hoặc lúc làm bài tập về nhà.*


(thực ra Qwen chỉ đứng ngoài cổ vũ thôi)
