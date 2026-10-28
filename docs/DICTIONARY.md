# Từ điển offline

## Nguồn

| Dữ liệu | Nguồn | Giấy phép | Ghim |
|---|---|---|---|
| Phiên âm | [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict) (ARPAbet → IPA, giọng Mỹ) | BSD 2 điều khoản ([licenses/CMUdict-LICENSE.txt](../licenses/CMUdict-LICENSE.txt)) | commit `74790861…`, SHA-256 trong `tools/dict/pins.json` |
| Loại từ, định nghĩa, ví dụ | Princeton WordNet 3.1 qua gói npm `wordnet-db@3.1.14` | WordNet License, cần ghi nguồn ([licenses/WordNet-LICENSE.txt](../licenses/WordNet-LICENSE.txt)) | SHA-256 trong `pins.json` |
| Dạng bất quy tắc (went → go) | Viết tay, `shared/irregular.ts` | | |

Dựng: `node tools/dict/build.ts --copy-web` (web) và `--copy-android` (APK). Kết quả đo trên bản dựng hiện tại: **146.874 mục** (63.940 là cụm từ), **36.182 mục có IPA** (CMUdict không có cụm từ và nhiều từ hiếm), 516 mảnh, ~20,7 MB thô, **~6,2 MB nén gzip** cả gói; một mảnh lớn nhất (`co`) ~0,7 MB thô.

## Chưa có: nghĩa tiếng Việt offline

Tôi chưa xác minh được giấy phép của các từ điển Anh-Việt mở (nhóm OVDP / StarDict-vi), nên **không đóng gói**. Nghĩa tiếng Việt hiện đến từ: người dùng nhập tay, hoặc AI (`enrich`). Muốn thêm từ điển Anh-Việt offline: xác nhận giấy phép cho phép nhúng/phân phối, rồi thêm một nguồn vào `tools/dict/build.ts` (trường thứ 5 của mỗi mục) và hiển thị ở `web/src/ui/Add.tsx` / `AddScreen.kt`.

## Giới hạn đã biết

- IPA chỉ giọng Mỹ, tự đổi từ ARPAbet; vị trí dấu nhấn dựa trên heuristic âm đầu (đã test với vài từ điển hình, chưa đối chiếu hàng loạt với từ điển in).
- WordNet thiên về nghĩa sách vở; từ hiện đại (app, email…) có thể thiếu hoặc nghĩa cũ. Lớp AI bổ sung.
- Xếp hạng gợi ý theo số lần gán nghĩa trong corpus của WordNet: thô, nhiều từ thông dụng có điểm 0.
- Tên riêng (viết hoa) bị loại.
