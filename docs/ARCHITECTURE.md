# Kiến trúc

## Tổng quan

```
Android (Compose, Room)  ⇄  Firestore users/{uid}/…  ⇄  Web (Preact, IndexedDB cache)
        │                          ▲                              │
  gói từ điển trong APK            │ Cloud Function `enrich`      gói từ điển trên Hosting
                                   │ (Gemini, Secret Manager)     (service worker cache)
```

- **Từ điển** (CMUdict + WordNet) chỉ đọc, đóng gói sẵn, **không đồng bộ**.
- **Dữ liệu người học** (bộ thẻ, ghi chú, thẻ, lịch sử ôn, bộ đếm theo ngày, cài đặt) nằm trong Firestore và được lưu cục bộ (Room trên Android, cache bền vững của Firestore trên web) nên dùng được khi mất mạng.

## Mô hình dữ liệu (kiểu Anki)

| Collection | Nội dung | Ghi chú |
|---|---|---|
| `decks/{id}` | Bộ thẻ | |
| `notes/{id}` | Nội dung: `type` + `fields` | `type = "vocab"` hôm nay |
| `cards/{noteId}.{template}` | Một thứ cần ôn + trạng thái FSRS | id xác định nên hai máy không tạo trùng |
| `reviews/{cardId}@{ts}` | Nhật ký trả lời, chỉ thêm | undo xoá đúng bản ghi vừa thêm |
| `daily/{yyyy-MM-dd}` | Bộ đếm theo ngày | cập nhật bằng `increment`, hai máy cộng dồn |
| `settings/prefs` | Cài đặt | |
| `meta/usage` | Hạn mức AI | chỉ Cloud Function ghi được |

Thời gian là epoch ms (số), không dùng Timestamp, để cùng một document đi qua Room, IndexedDB và Firestore không đổi.

## Đồng bộ

- Ghi vào kho cục bộ trước, rồi lên Firestore (SDK xếp hàng khi offline, **không `await` commit**).
- Thay đổi từ máy khác: listener ghi vào kho cục bộ; bỏ qua ghi của chính máy này (`hasPendingWrites`).
- Android, lần đầu server trả danh sách thật: tài liệu chỉ có trên máy được tải lên; tài liệu có cả hai nơi thì **bản cloud thắng**.
- Trạng thái thẻ: ghi sau thắng theo `updatedAt`. Nếu hai máy ôn cùng một thẻ khi offline, một lượt ôn có thể bị mất khỏi trạng thái thẻ (nhật ký `reviews` thì không mất). Tính lại trạng thái từ nhật ký là việc có thể làm sau.

## Lập lịch

FSRS-6 (thư viện `ts-fsrs` ở web, bản port Kotlin ở Android), `enable_short_term = true`, bước học 1p, 10p; học lại 10p; **fuzz tắt** để hai bản khớp từng byte. `shared/vectors/fsrs.json` ghi lại 10 kịch bản trả lời (lapse, trả lời muộn, cùng ngày, các mức retention 0.85/0.9/0.95).

Hàng đợi: thẻ đang học đến hạn → thẻ ôn đến hạn trước mốc đầu ngày học kế tiếp (mặc định 04:00) → thẻ mới (giới hạn mỗi ngày, rải đều giữa thẻ ôn); thẻ cùng ghi chú bị ẩn trong phiên sau khi trả lời một thẻ.

## Thẻ gõ và từ dễ nhầm

Nhiều từ có cùng nghĩa Việt (convince, persuade: "thuyết phục, làm cho tin"; ~31% từ đơn trong gói có nghĩa đầu trùng với từ khác), nên thẻ gõ phải chỉ ra đúng một từ. `shared/confusables.ts` (port: `android/core/.../Confusables.kt`, vector `shared/vectors/confusables.json`) tìm trong **chính các ghi chú của người học** những từ trùng một cụm nghĩa Việt (bỏ ngoặc, bỏ "sự/việc/cuộc/tính/một cách") hoặc trùng tiền tố dài (persuade/persuasion). Không dùng mạng hay từ điển; WordNet không xếp convince và persuade cùng synset nên không đủ.

- Mặt trước thẻ gõ: tiêu đề chế độ, chữ cái đầu + số chữ của đáp án, dòng "không phải: …" (tối đa 3 từ dễ nhầm). "Gợi ý thêm chữ" mở từng chữ, không bao giờ mở hết.
- Gõ một từ dễ nhầm (kể cả dạng chia: persuaded) lần đầu: "Đúng nghĩa, nhưng là từ khác", được gõ lại, không chấm. Lần hai sai thì chấm như thường.
- Đúng nhưng đã cần gợi ý thêm hoặc gõ lại: gợi ý xếp hạng hạ từ Tốt xuống Khó (`suggestedRatingWith`), để FSRS không tưởng là đã thuộc. Từ đồng nghĩa **không** được chấm đúng, vì thẻ kiểm tra đúng từ đó.
- Sau khi lật (mọi mẫu thẻ): khối "Dễ nhầm với" đặt từ đang ôn cạnh các từ dễ nhầm (loại từ, nghĩa Việt, định nghĩa Anh).

## Mặt đáp án và thẻ nghe

- Thứ tự mặt đáp án: nghĩa Việt → ví dụ (từ đang học được tô như bút dạ, kèm bản dịch) → mẹo nhớ → định nghĩa Anh-Anh thu gọn. Người học Việt nắm nghĩa nhanh nhất qua tiếng Việt; định nghĩa Anh dùng để phân biệt sắc thái sau đó.
- `examplesVi` là bản dịch của `examples`, cùng thứ tự (dòng thứ i dịch ví dụ thứ i). Thẻ điền vào câu gợi ý bằng bản dịch của câu khi có, vì bản dịch chỉ đúng một từ còn nghĩa rời thì trùng với từ đồng nghĩa.
- Mẫu `listen` (Nghe và gõ từ): máy đọc câu ví dụ đầu tiên chứa từ (TTS có sẵn trên máy, không tốn phí), người học thấy câu đã che từ và gõ lại từ nghe được. Không bật mặc định; bật trong Cài đặt → Mẫu thẻ.
- Block mới: `example`, `memo`, `fold`, `listen` (TS và Kotlin, khớp nhau qua `templates.json`).

## Thêm nội dung TOEIC / IELTS

Mọi thứ ngoài lớp "mẫu thẻ" đã không biết gì về từ vựng. Để thêm một loại ghi chú:

1. **`shared/notetypes.ts`**: thêm `NoteTypeDef` (danh sách trường, các `TemplateDef`) vào `NOTE_TYPES`. Mẫu thẻ là hàm thuần của ghi chú, trả về các `Block` (tiêu đề, văn bản, trích dẫn, nút đọc...). Ví dụ `toeic-mcq`: trường `question`, `options[]`, `answer`, `explanation`; mẫu `choose` với `mode = "choice"`.
2. **Chế độ trả lời mới** (nếu cần, ví dụ trắc nghiệm): thêm vào `AnswerMode` và xử lý trong `web/src/ui/Study.tsx` và `android/.../StudyScreen.kt`; chấm đúng/sai gợi ý xếp hạng như `suggestedRating`.
3. **`firestore.rules.tmpl`**: thêm tên loại vào `d.type in [...]` và một nhánh trong `validFields()`; thêm rules test.
4. **Bản Kotlin** (`android/core/.../NoteTypes.kt`): port cùng định nghĩa; sinh lại vector (`templates.json`) để test Kotlin bắt lệch.
5. Lưu trữ, đồng bộ, FSRS, hàng đợi, thư viện, thống kê và trình sửa ghi chú **không cần đổi** (trình sửa duyệt danh sách trường của loại ghi chú).

IELTS Writing/Speaking có chấm bằng AI sẽ cần thêm một callable trong `functions/` (cùng khuôn: đăng nhập → allowlist → hạn mức → Gemini) và một loại ghi chú lưu bài làm; chưa có trong MVP.

## Bảo mật

- Đăng nhập Google; chỉ email trong `allowed_emails` (điền vào rules lúc deploy, không nằm trong repo). Rules kiểm tra hình dạng mọi document và giới hạn kích thước truy vấn list.
- `enrich` kiểm tra đăng nhập + allowlist + hạn mức 100 lượt/ngày; khoá Gemini nằm trong Secret Manager; lời nhắc nằm phía server; từ người dùng nhập được xem là dữ liệu.
- CSP chặt trên Hosting (`default-src 'none'`); e2e chạy đúng CSP này.
- **App Check**: bản web dùng reCAPTCHA Enterprise nếu bật `enforce_app_check`; APK cài ngoài Play không lấy được token nên mặc định `false` (cùng lựa chọn với my-recap). Rules + allowlist vẫn chặn truy cập trái phép.
- Khoá ký APK `android/keystore/sideload.jks` **công khai có chủ đích** (để bản mới cài đè bản cũ); đừng dùng cho bản phát hành công khai.
