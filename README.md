# VH Lexi

Học từ vựng tiếng Anh bằng flashcard và lặp lại ngắt quãng (FSRS). Gõ một từ, thẻ tự điền phiên âm, loại từ, định nghĩa và ví dụ từ từ điển **offline**; nghĩa tiếng Việt và ví dụ tự nhiên có thể do AI điền. Dữ liệu đồng bộ giữa **app Android native** và **web** (`lexi.vhub.id.vn`) qua Firebase.

Thiết kế để mở rộng sang TOEIC / IELTS: mọi nội dung là một *loại ghi chú* (note type) đăng ký trong một registry, xem [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Trạng thái

| Phần | Trạng thái | Kiểm chứng |
|---|---|---|
| Từ điển offline (CMUdict + WordNet) | Chạy được | Test đơn vị, đo trên bản build thật |
| Web (Preact PWA) | Chạy được, offline | Unit, e2e Playwright dưới đúng CSP production, CI |
| Backend Firebase (rules, `enrich`) | Chạy trên emulator | Rules test, CloudRepo trên emulator Auth + Firestore, CI |
| Terraform + `deploy.mjs` | `terraform validate` đạt | **Chưa `apply` lên project thật** |
| Android (Compose, Room, sync) | Biên dịch + test lõi trên CI | **Chưa chạy trên máy thật/emulator** |
| AI `enrich` (Gemini) | Test đơn vị với fetch giả | **Chưa gọi Gemini thật** |

Chi tiết, rủi ro và việc còn lại: [docs/STATUS.md](docs/STATUS.md).

## Chạy thử nhanh (web, không cần Firebase)

```bash
node tools/dict/build.ts --copy-web     # tải CMUdict + WordNet, dựng gói từ điển (~6 MB nén)
cd web && npm ci && npm run dev         # http://localhost:5173, dữ liệu lưu trong IndexedDB
```

Không đặt biến `VITE_FIREBASE_*` thì app chạy ở chế độ chỉ-trên-máy (không đồng bộ, không AI).

## Cấu trúc

```
shared/      mô hình dữ liệu, registry loại ghi chú, IPA, morphology (TypeScript, dùng chung web + functions)
  vectors/   test vector sinh từ code TypeScript, bản Kotlin phải khớp từng byte
tools/dict/  dựng gói từ điển offline từ nguồn mở (ghim SHA-256)
web/         app web (Preact + Vite), repo IndexedDB và Firestore
android/     app Android (Compose + Room); core/ là Kotlin thuần, test trên JVM
functions/   Cloud Function `enrich` (Gemini) sau đăng nhập Google + allowlist + hạn mức ngày
infra/       Terraform + deploy.mjs (một lệnh từ máy trắng đến app chạy)
tests/       rules test (emulator), e2e Playwright
docs/        kiến trúc, cài đặt, từ điển, trạng thái
```

## Tài liệu

- [docs/SETUP.md](docs/SETUP.md): tạo project Firebase, deploy, nối `lexi.vhub.id.vn`, build Android
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): dữ liệu, đồng bộ, bảo mật, cách thêm loại ghi chú TOEIC/IELTS
- [docs/DICTIONARY.md](docs/DICTIONARY.md): nguồn từ điển, giấy phép, giới hạn
- [docs/STATUS.md](docs/STATUS.md): đã làm, chưa làm, rủi ro, nợ kỹ thuật

Giấy phép bên thứ ba: [licenses/](licenses/).
