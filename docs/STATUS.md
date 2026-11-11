# Trạng thái

Cập nhật theo kết quả CI và các lần chạy thật, không theo dự định.

## Đã kiểm chứng (có bằng chứng chạy)

| Hạng mục | Bằng chứng |
|---|---|
| Dựng từ điển | `tools/dict` build thật: 146.874 mục, 36.182 có IPA, 52.299 có nghĩa tiếng Việt (Wiktionary), ~7,6 MB nén; 6 test đơn vị (IPA, morphology, tách gloss, CMUdict, trích + gộp nghĩa Wiktionary) |
| Lõi web (FSRS, hàng đợi, mẫu thẻ, cloze, từ dễ nhầm, thống kê, repo IndexedDB, import/export) | 36 test vitest |
| Giao diện web | 11 kịch bản Playwright (thêm từ, ôn, gõ đáp án, từ dễ nhầm, hoàn tác, xoá có xác nhận, **offline sau lần truy cập đầu**, 3 cỡ màn hình không tràn ngang) chạy dưới đúng CSP của `firebase.json` |
| Học tuỳ chọn + thông tin thẻ | Vector `tag-filter`, `review-ahead` (TS sinh, Kotlin phát lại: `:core:test` xanh); 3 test vitest; e2e chọn bài → ôn trước → xem lịch sử thẻ; test tích hợp `reviewsOfNote` trên emulator. Giao diện Android chỉ kiểm qua CI |
| Nhập từ Anki (.apkg) | 17 test vitest trên 2 gói do Anki 26.9.3 tạo (anki21b + FSRS, anki21 + SM-2); e2e nhập dưới đúng CSP production, nhập lại không ghi đè; rules test cho mọi document được tạo. **Chưa thử với gói thật của người học** |
| Rules Firestore | 15 test trên emulator, gồm tài liệu do chính code app sinh ra (`fixtures.json`) |
| `CloudRepo` ↔ Firestore | 4 test trên emulator Auth + Firestore thật: hai thiết bị cùng tài khoản thấy ghi của nhau, bộ đếm theo ngày cộng dồn, undo lan truyền, tài khoản ngoài allowlist bị từ chối |
| Function `enrich` | 13 test đơn vị (validate đầu vào/đầu ra, retry, hạn mức, allowlist, CORS); build bundle thành công |
| Function `extract-questions` | 14 test đơn vị: validate ảnh/văn bản, chuẩn hoá chỗ trống, các cờ kiểm tra chéo, câu trùng giữa ảnh chồng nhau, gọi Gemini có ảnh, hạn mức theo chi phí; đầu ra mẫu viết tay theo ảnh Q131-134 của người học. **Chưa gọi Gemini thật với ảnh**: độ chính xác đọc ảnh chưa đo |
| Nhập nhanh từ đề (web) | 6 test vitest cho hàng duyệt + 3 e2e Playwright (ảnh → duyệt → sửa đáp án → lưu chỉ hàng đã chọn → trùng thẻ → đoạn sang tab Từ lạ; lỗi hết lượt; chưa đăng nhập) với hàm AI giả |
| Bộ đề từ PDF (web) | 17 test vitest đọc 2 PDF tự soạn thật bằng pdf.js (bản chữ hai cột + bản scan): thứ tự cột, dò trang đáp án (17 câu), chia phần, gộp/ghi đè đáp án, chấm theo Part, kho IndexedDB. 3 e2e Playwright dưới đúng CSP production: PDF chữ → 1 lần gọi AI (giả) có đáp án đúng câu → làm bài có đồng hồ, thoát rồi làm tiếp → nộp → 3/17, Part 5/6/7 → lưu Kết quả bài → thẻ từ câu sai; PDF scan → 2 lần gọi với ảnh JPEG 2+1 trang + đáp án dán tay; xoá có xác nhận (Không/Xoá). Nghe lại từng câu: unit test đo mức âm, khoảng lặng, tách câu, xếp câu theo file; e2e trên file Part 2 tự tạo (lời dẫn + 3 câu + nghỉ 5 s): 0:07/0:15/0:24 đúng, phát dừng đúng cuối câu, −2 s lưu qua reload. Chưa thử trên file đề ETS thật. Listening: unit test chia Part 1–4, tạo câu Part 1–2, chấm LC, sắp file nghe, xoá media; 2 e2e (PDF + 3 mp3 tự tạo): AI chỉ đọc trang Part 3, ảnh Part 1 hiện khi làm bài, audio tự sang file 2, LC 3/8 lưu vào Kết quả bài, xoá có xác nhận xoá luôn file nghe; mỗi câu một file → nút Nghe từng câu. Đã kiểm tra Chromium đọc được mp3 Big Step thật. Scan máy photo (CCITT 1-bit, lật ngược): e2e kiểm tra trang dựng ra có chữ (không trắng) và ảnh gửi AI đã xoay; đã chạy thử 150 trang Big Step thật qua app (chưa gọi Gemini thật). Chọn trang (PDF tới 150 MB): unit test cú pháp trang + e2e chọn trang 2-3 → chỉ các trang đó đi AI, đáp án dò trong trang đã chọn, trang sai bị từ chối. **Chưa chạy với Gemini thật và chưa thử PDF đề thật của nhà xuất bản** |
| Bộ đề trên Android (Reading) | Logic port Kotlin phát lại `testset.json` do TypeScript sinh (`:core:test` 7 test xanh: dò đáp án, chọn trang, chia phần, gộp, chấm, Kết quả bài, thẻ câu sai, thứ tự hai cột, dò khoảng lặng). Thứ tự chữ hai cột của PdfBox kiểm bằng PdfBox desktop cùng phiên bản API trên PDF mẫu: 3 trang, đáp án 17 câu ở trang 3, 1 phần ≈ 2 lượt AI, giống web. Màn Android: `TestSetsTest` trên emulator CI (PDF chữ → 1 lần gọi AI giả → làm bài → 1/3 → lưu Kết quả bài → thẻ câu sai → Làm lại/Xoá có xác nhận Huỷ/Đồng ý; scan máy photo vẽ ra có mực, xoay 180°). **Chưa chạy trên máy thật, chưa gọi Gemini thật** |
| Bộ đề trên Android (Listening) | `TestSetsTest` trên emulator CI với `listening-test.pdf` + mp3 tự tạo: chọn Listening, Part 1–2 theo số câu, trang ảnh Part 1, 3 file nghe sắp đúng thứ tự → AI (giả) chỉ đọc trang Part 3 → 8 câu → ảnh Part 1 hiện khi làm bài → phát sang file 2 tự động → LC 3/8, Part 1/2/3 → xoá có xác nhận xoá luôn 4 file media; mỗi câu một file → nút Nghe từng câu. **Chưa nghe thử trên máy thật, chưa thử mp3 đề ETS thật** |
| Nhập nhanh (Kotlin) | Vector `import.json`, `readcheck.json`, `testtag.json` do TypeScript sinh, test Kotlin phát lại: khớp. Màn Android (`ImportScreen`) chỉ kiểm qua CI/emulator, chưa chạy với Gemini thật |
| Terraform | `fmt` + `validate` đạt (provider google 8.9) |
| Lõi Kotlin (Android) | Test JVM phát lại vector do TypeScript sinh: FSRS 10 kịch bản, mẫu thẻ, cloze, kiểm tra đáp án, từ dễ nhầm, morphology, hàng đợi: khớp |
| App Android trên emulator | CI chạy APK debug trên emulator Android 15 (chế độ chỉ-lưu-trên-máy): thêm từ qua từ điển offline → ôn → thư viện → thống kê → cài đặt; chụp 9 màn hình, đã xem bằng mắt (release `android-ci-screens`) |
| CI | `Web and backend` (cả job `terraform`) và `Android` (test lõi, lint, APK release, emulator) xanh trên nhánh; Playwright từng chập chờn do 2 race (phím bấm trước khi effect chạy; test offline đọc sớm), đã sửa gốc và CI xanh sau đó |

Một lỗi thật do test tích hợp bắt được và đã sửa: `increment(-0)` bị Firestore lưu thành số thực, rules (`is int`) từ chối nên "hoàn tác" thẻ mới sẽ thất bại.

## Chưa kiểm chứng

- **App Android mới chạy trên emulator ở chế độ cục bộ.** Chưa chạy trên máy thật; đăng nhập Google (Credential Manager), đồng bộ Firestore thật và TTS chưa thấy chạy. Smoke test chỉ phủ một luồng.
- **Chưa `terraform apply`/deploy lên project Google thật**; chưa nối `lexi.vhub.id.vn`; chưa đăng nhập Google thật trên web.
- **Chưa gọi Gemini thật**: tên model mặc định (`gemini-3.5-flash-lite`) lấy từ my-recap; chất lượng nghĩa tiếng Việt và chi phí chưa đo.
- App Check bản web (reCAPTCHA Enterprise) chưa thử; Android không dùng App Check (xem ARCHITECTURE).
- Sync Android↔web chưa thử chéo thật (chỉ thử web↔web trên emulator, và Android đọc/ghi cùng định dạng document nhưng chưa chạy).
- Chất lượng nghĩa Việt từ Wiktionary: mới xem mẫu ~30 từ, chưa kiểm định hàng loạt (xem DICTIONARY.md).

## Giới hạn / nợ kỹ thuật

1. Xung đột hai máy ôn offline cùng thẻ: trạng thái thẻ ghi-sau-thắng, có thể mất một lượt ôn khỏi trạng thái (nhật ký vẫn còn).
2. Mở app lần đầu sau khi mất kết nối lâu có thể đọc lại toàn bộ thẻ (tối đa 10.000 lượt đọc); hạn mức miễn phí 50.000 lượt đọc/ngày.
3. FSRS không tối ưu tham số theo dữ liệu cá nhân (dùng tham số mặc định); fuzz tắt.
4. Bài kiểm tra e2e chưa phủ đăng nhập (Auth emulator) và sửa ghi chú trên giao diện.
5. Mẹo nhớ/ví dụ do AI sinh chỉ được lọc cơ học (phải chứa từ); chưa có bước kiểm chất lượng.
6. TOEIC: có `vocab`, `grammar` (thẻ điền câu Part 5) và `test` (kết quả bài làm thử, không tạo thẻ); chưa có câu hỏi trắc nghiệm đầy đủ (`toeic-mcq`) và chưa có luyện Listening trong app (xem mục Luyện đề trong ARCHITECTURE.md).
7. Android nhập câu sai qua ảnh/văn bản (màn Nhập từ đề thi), nhưng nhập kết quả bài và theo dõi mục tiêu (Part 5/6/7) vẫn chỉ có trên web. Quy tắc/bản dịch do AI viết có thể sai: luôn gắn nhãn AI và người học duyệt trước khi lưu. Danh sách từ quen ("common") trong `readcheck.ts` do tác giả viết tay, không phải danh sách tần suất từ kho ngữ liệu.
7. Android: thông báo (snackbar) hiện ở đáy, che các nút chấm điểm khoảng 4 giây sau khi lưu từ; cần chuyển lên đầu màn hình.
8. Android: trường hợp bàn phím che nút Lưu ở màn Thêm từ (người dùng phải cuộn); test phải gọi action thay vì chạm.
