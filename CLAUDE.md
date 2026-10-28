# Quy ước của project

## Xác nhận trước khi thực hiện thao tác phá huỷ

Mọi thao tác **xoá dữ liệu, xoá bộ thẻ, đăng xuất** (và các việc tương tự, không hoàn tác được) trên Android và web **phải hiện hộp thoại xác nhận** trước khi chạy; không bao giờ thực hiện ngay từ một cử chỉ, phím tắt hay nút bấm đơn lẻ. Nút huỷ ở bên trái, nút hành động bên phải, đỏ khi phá huỷ.

- Web: `confirmDialog({ ..., danger: true })` (`web/src/ui/common.tsx`). Android: `ConfirmDialog(destructive = true)` (`android/app/.../ui/Components.kt`).
- Tính năng mới có thao tác phá huỷ phải kèm test cho cả "Không" (dữ liệu còn nguyên) và "Xoá".

## Hai bản cài đặt phải khớp nhau

Lập lịch FSRS, hàng đợi ôn tập, mẫu thẻ, cloze, kiểm tra đáp án gõ và morphology có **một bản tham chiếu TypeScript** (`web/src`, `shared/`) và **một bản port Kotlin** (`android/core`). `shared/vectors/*.json` sinh từ TypeScript (`UPDATE_VECTORS=1 npx vitest run test/vectors.test.ts` trong `web/`); test Kotlin phát lại chúng. Đổi hành vi ở một bên thì sinh lại vector và sửa bên kia cho đến khi test khớp.

## Dữ liệu và bảo mật

- Mọi bản ghi là document phẳng dưới `users/{uid}/...`; `firestore.rules.tmpl` kiểm tra hình dạng từng document. Thêm trường/loại ghi chú mới thì sửa rules và thêm rules test.
- Danh sách email được phép chỉ nằm trong `terraform.tfvars` / biến môi trường CI, không bao giờ trong repo. Không commit `terraform.tfvars`, `terraform.tfstate`, khoá API.
- Không ghi nội dung từ vựng của người học vào log của Cloud Function.
