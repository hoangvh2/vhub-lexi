# Từ điển offline

## Nguồn

| Dữ liệu | Nguồn | Giấy phép | Ghim |
|---|---|---|---|
| Phiên âm | [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict) (ARPAbet → IPA, giọng Mỹ) | BSD 2 điều khoản ([licenses/CMUdict-LICENSE.txt](../licenses/CMUdict-LICENSE.txt)) | commit `74790861…`, SHA-256 trong `tools/dict/pins.json` |
| Loại từ, định nghĩa, ví dụ | Princeton WordNet 3.1 qua gói npm `wordnet-db@3.1.14` | WordNet License, cần ghi nguồn ([licenses/WordNet-LICENSE.txt](../licenses/WordNet-LICENSE.txt)) | SHA-256 trong `pins.json` |
| Nghĩa tiếng Việt (gợi ý) | Wiktionary tiếng Anh (bảng dịch sang tiếng Việt) và Wiktionary tiếng Việt (nghĩa của mục từ tiếng Anh), qua bản trích [kaikki.org](https://kaikki.org) (wiktextract) | CC BY-SA 4.0 ([licenses/Wiktionary-CC-BY-SA.txt](../licenses/Wiktionary-CC-BY-SA.txt)) | File đã trích, commit tại `tools/dict/data/vi-wiktionary.json.gz` (ghi ngày tải) |
| Dạng bất quy tắc (went → go) | Viết tay, `shared/irregular.ts` | | |

Dựng: `node tools/dict/build.ts --copy-web` (web) và `--copy-android` (APK). Kết quả đo trên bản dựng hiện tại: **146.874 mục** (63.940 là cụm từ), **36.182 mục có IPA** (CMUdict không có cụm từ và nhiều từ hiếm), **52.299 mục có nghĩa tiếng Việt**, 516 mảnh, ~24,4 MB thô, **~7,6 MB nén gzip** cả gói (nghĩa Việt thêm ~1,4 MB).

## Nghĩa tiếng Việt offline

Mỗi mục có thể có trường thứ 5: `[[pos, "nghĩa; nghĩa"], ...]`, `pos` là `n v a r` hoặc nhãn như `pron`, `prep`, `det`. Mỗi loại từ tối đa 3 nghĩa, ~90 ký tự. Thứ tự ưu tiên: bản dịch trong Wiktionary tiếng Anh (ngắn, hiện đại, gắn với nghĩa), rồi nghĩa trong Wiktionary tiếng Việt (độ phủ rộng nhưng cách diễn đạt cũ).

Khi chọn từ ở màn Thêm từ, ô "Nghĩa tiếng Việt" được điền sẵn theo loại từ của nghĩa đang chọn, gắn nhãn **Wiktionary**. Không bao giờ lấy nghĩa của một loại từ WordNet khác (nghĩa động từ cho thẻ danh từ); nếu không có thì để trống cho người dùng tự nhập hoặc bấm "Điền bằng AI". Người dùng sửa hoặc AI điền thì nhãn mất và giá trị đó được giữ khi đổi nghĩa.

Độ phủ đo ngày 2026-10-28 (Google 10k, bỏ từ không có trong gói): top 1.000 **97,4%**, top 5.000 **93%**, cả 7.133 từ **91,6%**; trên toàn gói 37% (63% từ đơn; cụm từ ít khi có).

Làm mới dữ liệu: chạy workflow **Dictionary - Vietnamese meanings** (Actions → Run workflow) trên một nhánh; nó tải hai bản trích (~3,4 GB + ~60 MB nén, không hợp để chạy trên máy cá nhân), dựng lại file và commit vào nhánh đó. Chạy tay: `node tools/dict/build.ts && node tools/dict/extract-vi.ts [--en file.jsonl] [--vi file.jsonl.gz]`.

## Giới hạn đã biết

- IPA chỉ giọng Mỹ, tự đổi từ ARPAbet; vị trí dấu nhấn dựa trên heuristic âm đầu (đã test với vài từ điển hình, chưa đối chiếu hàng loạt với từ điển in).
- WordNet thiên về nghĩa sách vở; từ hiện đại (app, email…) có thể thiếu hoặc nghĩa cũ. Lớp AI bổ sung.
- Nghĩa Việt từ Wiktionary là **gợi ý**: thứ tự nghĩa không theo tần suất (vd. `vintage` ra "sự hái nho" trước), một số nghĩa lấy từ bản nhập cũ của Wiktionary tiếng Việt nên diễn đạt cổ (`invoice`: "danh đơn hàng gửi" sau "hóa đơn"). Chưa có kiểm định chất lượng hàng loạt.
- Xếp hạng gợi ý theo số lần gán nghĩa trong corpus của WordNet: thô, nhiều từ thông dụng có điểm 0.
- Tên riêng (viết hoa) bị loại.
