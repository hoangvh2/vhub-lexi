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

## Học tuỳ chọn và thông tin thẻ (kiểu Anki)

- **Chọn bài**: màn Ôn tập có ô "Tất cả bài" liệt kê các nhãn (vd. `lesson-25` khi nhập từ Anki), xếp tự nhiên. Chọn một nhãn thì hàng đợi chỉ lấy các ghi chú có nhãn đó (`QueueInput.noteIds`); giới hạn thẻ mới/ôn mỗi ngày vẫn áp dụng.
- **Ôn trước**: khi hết thẻ, nút "Ôn trước N thẻ sắp đến hạn" thêm thẻ ôn của ngày học kế tiếp (`reviewAheadDays`, bấm nữa thì thêm một ngày). Lịch FSRS không đổi cách tính: trả lời sớm là một lượt ôn với số ngày trôi qua ngắn hơn. `dueWithin` đếm số thẻ cho nút.
- Cả hai nằm trong `buildQueue` (TS và Kotlin), được ghim bằng các kịch bản `tag-filter` và `review-ahead` trong `shared/vectors/queue.json`.
- **Thông tin thẻ** (trình sửa từ): trạng thái, khoảng ôn, khả năng nhớ lúc này, độ khó, độ bền trí nhớ, lượt ôn/quên, lần cuối, đến hạn. Web thêm lịch sử trả lời của ghi chú (`Repo.reviewsOfNote`: truy vấn `noteId ==` trên `reviews`, đọc cache khi offline), gồm cả lượt ôn nhập từ Anki. Android chỉ hiện dòng tóm tắt, vì app Android không tải `reviews` từ cloud.

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

## AI: nghĩa theo ngữ cảnh, truyện chêm, chạy hàng loạt

- `enrich` trả tối đa 3 nghĩa theo ngữ cảnh (công việc/TOEIC trước), mỗi nghĩa một câu ví dụ kèm bản dịch, bản dịch cho mọi ví dụ sẵn có (`existingVi`) và một truyện chêm (câu tiếng Việt có chèn từ tiếng Anh) trong `mnemonic`. Các nghĩa được ghép vào trường `vi` dạng `(công việc) trình diễn; (chung) chứng minh`, nên không cần trường mới; web và Android hiển thị mỗi ngữ cảnh một dòng có nhãn.
- Gộp vào ghi chú: `mergeEnrich` (`web/src/lib/enrich.ts`, port `android/core/.../Enrich.kt`). Không đè chữ người học viết: `vi`/`mnemonic` chỉ điền khi trống hoặc do AI viết trước đó, `en` chỉ khi trống; ví dụ mới thêm vào (tối đa 8). Câu có bản dịch được xếp lên trước câu chưa có, vì lưu ghi chú bỏ dòng trống và một bản dịch đứng sau chỗ trống sẽ lệch sang câu khác.
- Chạy hàng loạt (web và Android, Thư viện → Chọn → Điền bằng AI): `runBatch` (`web/src/lib/batch.ts`, port `AiBatch` trong `android/core`, giữ ở `LexiApp` để chạy tiếp khi đổi tab) gọi `enrich` cho từng từ, 3 lời gọi song song, lưu từng từ ngay khi có kết quả, chạy nền khi chuyển tab. Dừng khi người học bấm Dừng, hết hạn mức ngày (lọc “Chưa có AI” để chạy tiếp hôm sau) hoặc tài khoản bị từ chối; lỗi tạm thời thử lại 1 lần. Lựa chọn “Thay nghĩa tiếng Việt đang có” không hoàn tác được nên hỏi xác nhận (`confirmAndRun`).
- Log của function chỉ ghi số đếm, số token (`tokensIn`, `tokensOut`, `tokensThinking`) và thời gian, không ghi từ vựng; dùng số token để đo chi phí thật.

## Nhập từ Anki (.apkg)

Cài đặt → Dữ liệu → "Nhập từ Anki (.apkg)" (chỉ web; Android nhận dữ liệu qua đồng bộ). Chỉ nhập chữ và tiến độ ôn, **không nhập ảnh/âm thanh** (Lexi không có kho media; âm thanh dùng TTS của máy).

- **Đọc gói** (`web/src/lib/anki/read.ts`): giải nén bằng fflate, chọn `collection.anki21b` (zstd, fzstd) rồi `collection.anki21`; SQLite đọc bằng sql.js (WebAssembly nhúng trong một chunk ~1 MB, chỉ tải khi chọn file, không nằm trong precache). Vì vậy CSP có `'wasm-unsafe-eval'` trong `script-src`; e2e chứng minh thiếu nó thì nhập thất bại. Cột tên trong collection mới khai báo `COLLATE unicase` (collation Anki đăng ký bằng Rust), sql.js không có nên schema được viết lại sang collation mặc định trước khi đọc.
- **Chuyển đổi** (`web/src/lib/anki/convert.ts`, hàm thuần): đoán ánh xạ trường theo tên (TOEIC2: Target word, Transcription, Word type, Vietnamese, Explanation, Example, Translation), người học sửa được trong hộp thoại. HTML → chữ; ví dụ tách theo dòng, bỏ "a." "b."; `(v)` → `verb`. Bộ thẻ gốc thành 1 bộ thẻ Lexi (dùng lại bộ cùng tên), bộ con ("Lesson 01") thành nhãn `lesson-01`.
- **Tiến độ** (theo `rslib/src/import_export/package/apkg/import/cards.rs`, `storage/card/data.rs`): `due` của thẻ ôn là số ngày từ `col.crt` → epoch ms; thẻ đang học là epoch giây; thẻ mới giữ thứ tự Anki qua `createdAt`. Trí nhớ FSRS lấy từ `cards.data` (`s`, `d`) nếu Anki bật FSRS; nếu không thì phát lại nhật ký ôn qua FSRS của Lexi; không có nhật ký thì ước lượng từ interval + ease như `memory_state_from_sm2` (S = interval ở mức nhớ 90%). Thẻ tạm dừng giữ tạm dừng. Mẫu thẻ Lexi bật mà Anki không có (vd. cloze) thành thẻ mới.
- **Nhật ký**: mỗi lượt trả lời (ease 1–4) thành `reviews` với `device: "anki"` và cộng vào `daily` (cộng dồn với số của Lexi cùng ngày), nên thống kê, heatmap, chuỗi ngày có cả lịch sử Anki.
- **Không ghi đè**: ghi chú có id `anki-<note id>` đã có, hoặc từ đã có trong Lexi (mọi bộ thẻ), bị bỏ qua cùng nhật ký của nó. Nhập lại cùng file không làm mất tiến độ học trong Lexi.
- Hộp thoại báo số lượt ghi Firestore cần dùng (mỗi note/thẻ/lượt ôn là 1 lượt), cảnh báo khi gần 20.000 lượt/ngày miễn phí.
- Test: `web/test/anki.test.ts` đọc 2 gói thật do thư viện Python chính thức của Anki tạo (`tools/anki/make-fixture.py`, bản mới có FSRS và bản cũ SM-2); rules test ghi lại mọi document mà lần nhập tạo ra.

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
- `enrich` kiểm tra đăng nhập + allowlist + hạn mức 300 lượt/ngày; khoá Gemini nằm trong Secret Manager; lời nhắc nằm phía server; từ người dùng nhập được xem là dữ liệu.
- CSP chặt trên Hosting (`default-src 'none'`); e2e chạy đúng CSP này.
- **App Check**: bản web dùng reCAPTCHA Enterprise nếu bật `enforce_app_check`; APK cài ngoài Play không lấy được token nên mặc định `false` (cùng lựa chọn với my-recap). Rules + allowlist vẫn chặn truy cập trái phép.
- Khoá ký APK `android/keystore/sideload.jks` **công khai có chủ đích** (để bản mới cài đè bản cũ); đừng dùng cho bản phát hành công khai.
