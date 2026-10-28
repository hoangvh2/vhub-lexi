# Trạng thái

Cập nhật theo kết quả CI và các lần chạy thật, không theo dự định.

## Đã kiểm chứng (có bằng chứng chạy)

| Hạng mục | Bằng chứng |
|---|---|
| Dựng từ điển | `tools/dict` build thật: 146.874 mục, 36.182 có IPA, ~6,2 MB nén; 4 test đơn vị (IPA, morphology, tách gloss, CMUdict) |
| Lõi web (FSRS, hàng đợi, mẫu thẻ, cloze, thống kê, repo IndexedDB, import/export) | 32 test vitest |
| Giao diện web | 10 kịch bản Playwright (thêm từ, ôn, gõ đáp án, hoàn tác, xoá có xác nhận, **offline sau lần truy cập đầu**, 3 cỡ màn hình không tràn ngang) chạy dưới đúng CSP của `firebase.json` |
| Rules Firestore | 15 test trên emulator, gồm tài liệu do chính code app sinh ra (`fixtures.json`) |
| `CloudRepo` ↔ Firestore | 4 test trên emulator Auth + Firestore thật: hai thiết bị cùng tài khoản thấy ghi của nhau, bộ đếm theo ngày cộng dồn, undo lan truyền, tài khoản ngoài allowlist bị từ chối |
| Function `enrich` | 13 test đơn vị (validate đầu vào/đầu ra, retry, hạn mức, allowlist, CORS); build bundle thành công |
| Terraform | `fmt` + `validate` đạt (provider google 8.9) |
| Lõi Kotlin (Android) | Test JVM phát lại vector do TypeScript sinh: FSRS 10 kịch bản, mẫu thẻ, cloze, kiểm tra đáp án, morphology, hàng đợi: khớp |
| CI | Workflow `Web and backend` (cả job `terraform`) xanh trên nhánh |

Một lỗi thật do test tích hợp bắt được và đã sửa: `increment(-0)` bị Firestore lưu thành số thực, rules (`is int`) từ chối nên "hoàn tác" thẻ mới sẽ thất bại.

## Chưa kiểm chứng

- **App Android chưa chạy trên máy hay emulator.** Chỉ có kết quả build/lint/test lõi từ CI (xem mục dưới). Giao diện Compose, đăng nhập Google (Credential Manager), đồng bộ thật, TTS: chưa thấy chạy.
- **Chưa `terraform apply`/deploy lên project Google thật**; chưa nối `lexi.vhub.id.vn`; chưa đăng nhập Google thật trên web.
- **Chưa gọi Gemini thật**: tên model mặc định (`gemini-3.5-flash-lite`) lấy từ my-recap; chất lượng nghĩa tiếng Việt và chi phí chưa đo.
- App Check bản web (reCAPTCHA Enterprise) chưa thử; Android không dùng App Check (xem ARCHITECTURE).
- Sync Android↔web chưa thử chéo thật (chỉ thử web↔web trên emulator, và Android đọc/ghi cùng định dạng document nhưng chưa chạy).
- Giấy phép/chất lượng từ điển Anh-Việt: chưa có (xem DICTIONARY.md).

## Giới hạn / nợ kỹ thuật

1. Xung đột hai máy ôn offline cùng thẻ: trạng thái thẻ ghi-sau-thắng, có thể mất một lượt ôn khỏi trạng thái (nhật ký vẫn còn).
2. Mở app lần đầu sau khi mất kết nối lâu có thể đọc lại toàn bộ thẻ (tối đa 10.000 lượt đọc); hạn mức miễn phí 50.000 lượt đọc/ngày.
3. FSRS không tối ưu tham số theo dữ liệu cá nhân (dùng tham số mặc định); fuzz tắt.
4. Bài kiểm tra e2e chưa phủ đăng nhập (Auth emulator) và sửa ghi chú trên giao diện.
5. Mẹo nhớ/ví dụ do AI sinh chỉ được lọc cơ học (phải chứa từ); chưa có bước kiểm chất lượng.
6. TOEIC/IELTS: kiến trúc sẵn sàng (xem ARCHITECTURE.md) nhưng chưa có loại ghi chú nào ngoài `vocab`.
7. Test e2e có một lần chập chờn trong lúc phát triển (đã gia cố, chưa tái hiện); theo dõi trên CI.
