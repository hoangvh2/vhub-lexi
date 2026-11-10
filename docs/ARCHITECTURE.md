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

FSRS-6 (thư viện `ts-fsrs` ở web, bản port Kotlin ở Android), `enable_short_term = true`, bước học 1p, 10p; học lại 10p; **fuzz tắt** để hai bản khớp từng byte. `shared/vectors/fsrs.json` ghi lại các kịch bản trả lời (lapse, trả lời muộn, cùng ngày, các mức retention 0.85/0.9/0.95).

Hàng đợi: thẻ đang học đến hạn → thẻ ôn đến hạn trước mốc đầu ngày học kế tiếp (mặc định 04:00) → thẻ mới (giới hạn mỗi ngày, rải đều giữa thẻ ôn); thẻ cùng ghi chú bị ẩn trong phiên sau khi trả lời một thẻ.

- **Thứ tự giới thiệu từ mới**: các thẻ mới tạo cùng lúc (mọi lần nhập Anki, mọi từ thêm khi bật nhiều mẫu thẻ) xếp theo `INTRO_ORDER` = recognize, recall, cloze, listen, nên từ mới luôn gặp ở thẻ "nhớ nghĩa" trước, thẻ gõ để phiên sau (một thẻ mới mỗi ghi chú mỗi phiên). Vector `intro-order`.
- **Thuộc nghĩa rồi mới gõ**: thẻ gõ mới (recall, cloze, listen) của một từ chỉ được đưa ra khi thẻ recognize của từ đó đã ở trạng thái Review (`awaitingRecognize`, `introducible`); recognize còn mới/đang học/học lại thì thẻ gõ chờ. Từ không có thẻ recognize còn sống (tắt mẫu, tạm ngưng, loại ghi chú khác) thì không bị giữ. Thẻ mới của một từ đã trả lời trong ngày cũng chờ sang ngày học sau (`answeredToday`), nên thoát rồi vào lại không còn thấy thẻ gõ của từ vừa học như "Mới". Vector `typing-waits-for-recognize`.
- **Quota "Mới" đếm theo từ**: chỉ thẻ recognize dùng suất `newPerDay`. Thẻ gõ của từ đã nhận ra (ghi chú có thẻ recognize còn sống) là thẻ miễn phí (`isFreeNew`): mỗi từ một thẻ mỗi ngày, nằm ngoài quota, trả lời tính là một lượt ôn (`reviews`, không phải `newCards`, không vào `newByDeck`). Ghi chú không có thẻ recognize (tắt mẫu, loại ghi chú khác) vẫn đếm từng thẻ như cũ. Thẻ miễn phí hiện trong nhóm **Ôn** (`Queue.review`, sau các thẻ đến hạn, chịu giới hạn `maxReviewsPerDay`; `Queue.freeNew` là tập con đó), không bao giờ trong `newCards`, nên tab "Mới" chỉ có thẻ recognize (từ mới) và số "Mới" mỗi ngày luôn là từ khác nhau. Mỗi thẻ vẫn có lịch FSRS riêng. Vector `quota-counts-words`.
- **Học trước 20 phút** (như "learn ahead limit" của Anki): khi hết thẻ khác, thẻ đang học đến hạn trong 20 phút được hiện luôn thay vì kết thúc phiên với "quay lại sau 3 phút". Nút "Học tiếp ngay" chỉ còn cho thẻ xa hơn.
- **Thẻ mới không có trí nhớ**: ts-fsrs chỉ coi (stability 0, difficulty 0) là "chưa học"; cả hai bộ lập lịch bỏ qua giá trị lưu trên thẻ ở trạng thái New (trình nhập Anki đầu tiên từng lưu difficulty 1 làm "Hiện đáp án" lỗi). Vector `new-with-stale-memory`.

### Tối ưu tham số FSRS (nút "Optimize" của Anki)

- Cài đặt (web) → "Tối ưu theo lịch sử ôn": chạy **optimizer chính thức của FSRS** (fsrs-rs, gói `@open-spaced-repetition/binding-wasm32-wasip1`, cùng mã Anki dùng) ngay trong trình duyệt, trong một Worker (`web/src/lib/optimizer.worker.ts`). Bản WASI này không dùng thread nên không cần `SharedArrayBuffer` / cross-origin isolation; COOP vẫn là `same-origin-allow-popups` để đăng nhập Google bằng popup. Không có server, không gửi dữ liệu đi, $0.
- Dữ liệu: mọi `reviews` (Firestore đọc theo trang `REVIEW_PAGE` = 5.000 vì mỗi truy vấn production chỉ cho tối đa 10.000 document; mỗi lượt ôn là 1 lượt đọc, 50.000 lượt đọc/ngày miễn phí) → CSV theo định dạng benchmark FSRS (số thẻ, thời điểm, đánh giá, trạng thái lúc trả lời; không có từ vựng) → `convertCsvToFsrsItems` với mốc đầu ngày học và múi giờ của máy → `computeParameters` (FSRS-6, short-term bật, 1 bước học lại).
- Chỉ giữ khi tốt hơn: so RMSE (độ lệch giữa khả năng nhớ dự đoán và thực tế, theo nhóm) của tham số đang dùng và tham số mới trên cùng lịch sử. Không tốt hơn thì báo "không cần đổi"; quá ít dữ liệu thì fsrs-rs trả `NotEnoughData` và màn hình báo chưa đủ lịch sử. Người học bấm "Áp dụng" mới lưu.
- Lưu ở `Prefs.fsrsWeights` (21 số, **đã clip** bằng `clipParameters` của ts-fsrs nên bản Kotlin, vốn không clip, cho cùng lịch), `fsrsOptimizedAt`, `fsrsOptimizedReviews`. Rules kiểm tra đúng 21 số. Cả hai bộ lập lịch đọc từ lượt ôn kế tiếp (`makeScheduler(retention, w)`, `Prefs.fsrs()`); Android chỉ hiển thị trạng thái. Vector `optimized-weights*` chốt việc mọi công thức đọc `w`.
- Chưa làm (giống Anki khi không bật "Reschedule cards on change"): trí nhớ và ngày đến hạn đã lưu trên các thẻ giữ nguyên, không tính lại từ nhật ký. Màn Cài đặt nhắc tối ưu lại khi số lượt ôn đã gấp đôi lần trước.
- Test: `web/test/optimizer.test.ts` (bản Node của cùng module WASI, lịch sử mô phỏng một người quên nhanh), e2e "FSRS optimizer" chạy thật trong Chromium với CSP production.

## Màn Hôm nay và phiên học

Tab Ôn tập mở màn **Hôm nay** (`web/src/ui/Today.tsx`, Android `TodayPanel`): vòng tiến độ tính theo thẻ (thẻ đã trả lời hôm nay và không còn chờ / tổng), nút Bắt đầu học, ô Đến hạn và Từ mới, chuỗi ngày với 7 ngày của tuần, bài đang học và lưới tất cả các bài (nhãn dạng bài: `01-…`, `lesson…`, `bai…`). Ước lượng phút lấy theo tốc độ trả lời thật của người học (`daily.ms`). Trong phiên, nút "Hiện đáp án" và hàng chấm điểm ghim ở đáy màn hình; mẹo nhớ thu gọn sau một chip. Cuối phiên: các từ vừa ôn tô màu theo điểm, danh sách "Cần chú ý" (từ chấm Quên), số thẻ ngày mai, nút sang bài tiếp. Thư viện có vòng trạng thái mỗi từ (chưa học / đang học / đã thuộc = mọi thẻ có khoảng ôn từ 21 ngày).

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

## AI: nghĩa theo ngữ cảnh, mẹo nhớ, chạy hàng loạt

- `enrich` trả tối đa 3 nghĩa theo ngữ cảnh (công việc/TOEIC trước), mỗi nghĩa một câu ví dụ kèm bản dịch, bản dịch cho mọi ví dụ sẵn có (`existingVi`) và một mẹo nhớ ngắn trong `mnemonic`: ưu tiên chơi chữ theo âm tiếng Việt (`Đọc như "con vịt": Cố thuyết phục một con vịt biết nói tiếng Anh.`), không có âm tự nhiên thì dùng liên tưởng ngắn (gốc từ...); tối đa 120 ký tự, dài hơn bị bỏ. So sánh trước/sau bằng model thật: `node functions/scripts/memo-eval.mjs` (cần `GEMINI_API_KEY`). Các nghĩa được ghép vào trường `vi` dạng `(công việc) trình diễn; (chung) chứng minh`, nên không cần trường mới; web và Android hiển thị mỗi ngữ cảnh một dòng có nhãn.
- Gộp vào ghi chú: `mergeEnrich` (`web/src/lib/enrich.ts`, port `android/core/.../Enrich.kt`). Không đè chữ người học viết: `vi`/`mnemonic` chỉ điền khi trống hoặc do AI viết trước đó, `en` chỉ khi trống; ví dụ mới thêm vào (tối đa 8). Câu có bản dịch được xếp lên trước câu chưa có, vì lưu ghi chú bỏ dòng trống và một bản dịch đứng sau chỗ trống sẽ lệch sang câu khác.
- Chạy hàng loạt (web và Android, Thư viện → Chọn → Điền bằng AI): `runBatch` (`web/src/lib/batch.ts`, port `AiBatch` trong `android/core`, giữ ở `LexiApp` để chạy tiếp khi đổi tab) gọi `enrich` cho từng từ, 3 lời gọi song song, lưu từng từ ngay khi có kết quả, chạy nền khi chuyển tab. Dừng khi người học bấm Dừng, hết hạn mức ngày (lọc “Chưa có AI” để chạy tiếp hôm sau) hoặc tài khoản bị từ chối; lỗi tạm thời thử lại 1 lần. Lựa chọn “Thay nghĩa tiếng Việt đang có” không hoàn tác được nên hỏi xác nhận (`confirmAndRun`).
- Log của function chỉ ghi số đếm, số token (`tokensIn`, `tokensOut`, `tokensThinking`) và thời gian, không ghi từ vựng; dùng số token để đo chi phí thật.

## Nhập từ Anki (.apkg)

Cài đặt → Dữ liệu → "Nhập từ Anki (.apkg)" (chỉ web; Android nhận dữ liệu qua đồng bộ). Chỉ nhập chữ và tiến độ ôn, **không nhập ảnh/âm thanh** (Lexi không có kho media; âm thanh dùng TTS của máy).

- **Đọc gói** (`web/src/lib/anki/read.ts`): giải nén bằng fflate, chọn `collection.anki21b` (zstd, fzstd), rồi `collection.anki21`, rồi `collection.anki2` (gói cũ, như bộ 600 Essential tải từ AnkiWeb); SQLite đọc bằng sql.js (WebAssembly nhúng trong một chunk ~1 MB, chỉ tải khi chọn file, không nằm trong precache). Vì vậy CSP có `'wasm-unsafe-eval'` trong `script-src`; e2e chứng minh thiếu nó thì nhập thất bại. Cột tên trong collection mới khai báo `COLLATE unicase` (collation Anki đăng ký bằng Rust), sql.js không có nên schema được viết lại sang collation mặc định trước khi đọc.
- **Chuyển đổi** (`web/src/lib/anki/convert.ts`, hàm thuần): đoán ánh xạ trường theo tên (TOEIC2: Target word, Transcription, Word type, Vietnamese, Explanation, Example, Translation), người học sửa được trong hộp thoại. HTML → chữ; ví dụ tách theo dòng, bỏ "a." "b." (cả khi dính liền "a.The"); `(v)` → `verb`, `/v-n/` → `verb, noun`. Dòng chú thích lẫn trong ô ví dụ ("withstand : chống lại", "serve /sə:v/: …", dòng "•", "-->", "(…)", một từ, chữ thường đầu dòng) chuyển xuống cuối ô Giải thích để câu dịch vẫn khớp đúng ví dụ theo thứ tự; câu tiếng Việt gõ nhầm vào ô ví dụ thành câu dịch nếu ô dịch trống. Các quy tắc này lấy từ bộ 600 Essential thật (34/616 từ bị lệch trước khi sửa). Bộ thẻ gốc thành 1 bộ thẻ Lexi (dùng lại bộ cùng tên), bộ con ("Lesson 01") thành nhãn `lesson-01`.
- **Tiến độ** (theo `rslib/src/import_export/package/apkg/import/cards.rs`, `storage/card/data.rs`): `due` của thẻ ôn là số ngày từ `col.crt` → epoch ms; thẻ đang học là epoch giây; thẻ mới giữ thứ tự Anki qua `createdAt`. Trí nhớ FSRS lấy từ `cards.data` (`s`, `d`) nếu Anki bật FSRS; nếu không thì phát lại nhật ký ôn qua FSRS của Lexi; không có nhật ký thì ước lượng từ interval + ease như `memory_state_from_sm2` (S = interval ở mức nhớ 90%). Thẻ tạm dừng giữ tạm dừng. Mẫu thẻ Lexi bật mà Anki không có (vd. cloze) thành thẻ mới.
- **Nhật ký**: mỗi lượt trả lời (ease 1–4) thành `reviews` với `device: "anki"` và cộng vào `daily` (cộng dồn với số của Lexi cùng ngày), nên thống kê, heatmap, chuỗi ngày có cả lịch sử Anki.
- **Từ có ở hai bài** (600 Essential có 6 từ như "express", "appeal"): gộp vào ghi chú đầu tiên, thêm nhãn bài thứ hai, nối nghĩa và ví dụ (câu dịch chỉ nối khi mọi ví dụ trước đã có câu dịch); thẻ của bản sau bị bỏ.
- **Gói không có tiến độ** (bộ thẻ tải từ AnkiWeb, hoặc xuất mà tắt "Include scheduling information"): hộp thoại cảnh báo mọi thẻ sẽ là thẻ mới.
- **Không ghi đè**: ghi chú có id `anki-<note id>` đã có, hoặc từ đã có trong Lexi (mọi bộ thẻ), bị bỏ qua cùng nhật ký của nó. Nhập lại cùng file không làm mất tiến độ học trong Lexi.
- Hộp thoại báo số lượt ghi Firestore cần dùng (mỗi note/thẻ/lượt ôn là 1 lượt), cảnh báo khi gần 20.000 lượt/ngày miễn phí.
- Test: `web/test/anki.test.ts` đọc 2 gói thật do thư viện Python chính thức của Anki tạo (`tools/anki/make-fixture.py`, bản mới có FSRS và bản cũ SM-2); rules test ghi lại mọi document mà lần nhập tạo ra.

## Luyện đề (vòng lặp đề thi → thẻ → tiến độ)

Một vòng khép kín, không thêm collection Firestore: mọi thứ là `Note` của một kiểu đã đăng ký.

- **`test`** (`shared/notetypes.ts`): kết quả một bài làm thử, trường là chuỗi ("20/30" = đúng/tổng; số câu sai theo lý do V/G/P/T). Không có mẫu thẻ nên không bao giờ vào hàng đợi; `isMaterial()` loại nó khỏi Thư viện và số từ.
- **`grammar`**: câu Part 5 + đáp án + quy tắc; mẫu `fill` (gõ lại đáp án). Chỗ trống tìm bằng `findExact` (nguyên từ, không biến thể: "completion" không che "complete").
- **Từ lạ** (`web/src/lib/readcheck.ts`, hàm thuần): dán đoạn đọc, từ nào không thuộc (chung / có thẻ đã ôn / "biết rồi") thì đánh dấu; độ phủ = từ phủ / từ đếm (bỏ tên riêng, viết tắt, số). Bấm một từ → từ điển offline + câu trong đề làm ví dụ → `vocab` gắn nhãn `de-<tên bài>`.
- Mọi thẻ tạo từ một bài mang nhãn `de-<slug tên bài>` (hạn 10 nhãn/ghi chú theo rules), nên "học các từ của bài này" là Học tuỳ chọn theo nhãn có sẵn.
- **Today** (`Readiness.tsx`) đọc các ghi chú `test` và đếm theo nhãn để hiện RC đúng/mục tiêu, từng Part, lý do sai nhiều nhất và nút tiếp theo. Mục tiêu (`practice.ts`: Part 5 25, Part 6 11, Part 7 34 = 70/100 RC) là giả định cho khoảng 700 điểm, không phải bảng quy đổi của ETS.
- Rules: `grammarFields`, `testFields`; Kotlin có bản port của hai kiểu và vector `grammar`/`noCards`.

### Nhập nhanh (ảnh chụp hoặc văn bản → AI đọc → người học duyệt → thẻ)

Nhập tay từng câu quá chậm khi một bài sai ~47 câu, nên có một callable thứ hai, `extract-questions` (entry point `extractQuestions`, Terraform riêng, cùng gói code và cùng cổng kiểm tra với `enrich`):

- **Vào**: tối đa 6 ảnh (JPEG/PNG/WebP, ≤ 1,5 MB base64 mỗi ảnh, ≤ 6 MB tổng; client thu nhỏ về ~2000 px) và/hoặc ≤ 12.000 ký tự văn bản. Ảnh chỉ tồn tại trong một lần gọi, không lưu. Văn bản dán là dữ liệu, không phải chỉ thị.
- **Ra** (`functions/src/extract.ts`): `passages` (đoạn đọc, có cờ `truncated`) và `questions` (`kind` fill / insert / reading, `stem` có chỗ trống `_____`, 4 đáp án, `correct`, `result` wrong/right/unknown, `topic`, `rule`, `translation`, `flags`). Phía server làm các kiểm tra cơ học: chuẩn hoá chỗ trống, đáp án đúng phải là một lựa chọn có chữ, bỏ câu trùng giữa các ảnh chồng nhau, chủ đề ngoài danh sách thành rỗng, **không giữ quy tắc/bản dịch khi không có đáp án đúng** (chúng sẽ giải thích một đoán mò).
- **Hạn mức**: dùng chung 300 đơn vị/ngày; một lần đọc ảnh tốn 3, văn bản 2 (`LIMITS.extractImageCost/extractTextCost`). Log chỉ có số lượng, token và thời gian, không có nội dung.
- **Duyệt** (`web/src/lib/import.ts`, port `android/core/.../Import.kt`, vector `shared/vectors/import.json`): chỉ câu `fill` thành hàng ngữ pháp; `insert`/`reading` chỉ được đếm. Hàng chặn lưu khi thiếu đáp án / chỗ trống / đáp án không khớp chỗ trống; cảnh báo khi trùng thẻ có sẵn, AI không chắc, thiếu đáp án (ảnh bị cắt), bạn đã làm đúng. Mặc định chỉ chọn câu sai hoặc chưa rõ kết quả mà qua mọi kiểm tra. Đổi đáp án đúng bằng tay thì quy tắc/bản dịch do AI viết cho đáp án cũ bị xoá. Trường AI viết mà người học không sửa được gắn nhãn AI (`aiFields`).
- **Đoạn đọc** đi vào đúng chức năng Từ lạ: web đưa văn bản sang tab Từ lạ (độ phủ, bấm từng từ); Android (`ReadCheck.kt`, port `readcheck.ts`, vector `readcheck.json`) liệt kê từ lạ kèm gợi ý Wiktionary để chọn nhiều từ rồi thêm. Thẻ mang nhãn `de-<bài gần nhất>` (Android lấy bài có ngày mới nhất, kết quả bài nhập trên web).
- **Vào ứng dụng**: web chọn/kéo thả/dán ảnh (Ctrl+V); Android chọn ảnh hoặc "Chia sẻ" ảnh thẳng vào Lexi.

### Bộ đề (đề Reading từ file PDF → làm bài trong Lexi → kết quả + thẻ)

Một bài đề đầy đủ cần làm trọn trong Lexi, không chỉ mang câu sai về. Chỉ có trên web.

- **Đọc PDF trên máy** (`web/src/lib/pdf.ts`, pdf.js tải lười ~1,5 MB, worker là module `.js` của chính site, `isEvalSupported: false` theo CSP): chữ từng trang theo thứ tự đọc; trang hai cột (Part 5 trong sách đề) đọc hết cột trái rồi cột phải. Trang gần như không có chữ (< 40 ký tự) là trang scan: dựng thành JPEG ~1600 px để gửi như ảnh.
- **Bảng đáp án** (`web/src/lib/testset.ts`, hàm thuần): trang mà các cặp "101 (A)" chiếm phần lớn nội dung (hoặc có tiêu đề Answer key / Đáp án và ≥ 25%) là trang đáp án: dò bằng code, không gửi cho AI. Người học có thể dán thêm bảng đáp án (bản scan không dò được).
- **Chia phần cho `extract-questions`** (không đổi function): trang chữ ghép tới 5.000 ký tự/lần (trang dài cắt ở đầu một câu hỏi), trang scan 2 ảnh/lần, để bản chép lại + JSON nằm trong 8.000 token ra của function. Mỗi phần mang theo đáp án của đúng các câu trong phần đó ("Answer key (data …)"). Gộp kết quả: bỏ câu trùng theo số câu, **bảng đáp án của file thắng chữ AI đọc** (khác nhau thì gắn cờ `key-differs`, bỏ quy tắc AI viết cho chữ cái khác), Part lấy theo số câu (101–130 / 131–146 / 147–200), bỏ đoạn đọc không câu nào trỏ tới. Hết lượt AI giữa chừng thì giữ phần đã đọc và báo các trang còn thiếu.
- **Lưu trên máy, không đồng bộ** (`web/src/data/testsets.ts`, IndexedDB `lexi-private`): nội dung đề là bản sao để tự học nên không lên Firestore, không vào file Xuất JSON, không cần rules mới. Bài làm dở (lựa chọn, thời gian) lưu cùng bộ đề; rời màn hình hoặc ẩn tab thì đồng hồ dừng.
- **Chấm** (`grade`): theo Part, câu bỏ trống tính sai, câu không có đáp án không chấm. "Lưu vào Kết quả bài" tạo ghi chú `test` như form nhập tay. `fullRc` chỉ đúng khi ba Part đủ 30/16/54 câu, nên một bộ đề ngắn không bị so với mục tiêu 70/100.
- **Câu sai → thẻ**: câu `fill` sai đi vào đúng bảng duyệt của Nhập nhanh (`DraftReview`), gắn nhãn `de-<tên bộ đề>`; câu đọc hiểu / chèn câu sai thì đưa đoạn đọc sang tab Từ lạ.

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

## Gợi ý khi ôn tập: Mẹo và Ghi chú

- Từ vựng có thêm trường `notes` (ghi chú riêng, 500 ký tự). Mặt trước thẻ có 2 nút: Mẹo (`mnemonic`) và Ghi chú (`notes`). Logic nằm ở `shared/hints.ts`, bản Kotlin `android/core/.../Hints.kt` phát lại `shared/vectors/hints.json`.
- Chống học vẹt: nút ngủ 4 giây trên thẻ ôn (6 giây khi stability ≥ 21 ngày, 0 với thẻ mới/đang học); bấm lần 1 hiện manh mối (`hintCue`), lần 2 hiện đầy đủ; đáp án luôn bị che (`maskHint`: nghĩa tiếng Việt ở thẻ recognize, mọi dạng của từ tiếng Anh ở thẻ gõ).
- Dùng gợi ý thì giới hạn điểm (`maxRating`: mức 1 tối đa Tốt, mức 2 tối đa Khó) và ghi `hint` vào ReviewLog; Firestore rules từ chối log vượt giới hạn. Từ dùng gợi ý 3/5 lần gần nhất bị khoá gợi ý ở mặt trước (`hintDependent`), mở lại sau 2 lần liên tiếp tự nhớ được (Tốt/Dễ).
- Mặt sau: ví dụ xoay vòng theo `card.reps`; Mẹo và Ghi chú có nút sửa ngay. Nút "AI gợi ý mẹo" gọi `enrich` với `only: "memo"` (prompt ngắn `MEMO_PROMPT`, 1 lượt AI), chỉ lưu khi bấm Lưu.
