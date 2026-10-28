# infra/

Terraform + một lệnh deploy cho VH Lexi. Hướng dẫn từng bước (kèm các bước làm tay) ở [docs/SETUP.md](../docs/SETUP.md).

| File | Việc |
|---|---|
| `apis.tf` | Bật API, danh sách email (`local.emails`) |
| `firebase.tf` | Firebase project, web app, (tuỳ chọn) Android app + SHA-1 |
| `firestore.tf` | Database `(default)` (PITR 7 ngày, chống xoá nhầm), rules sinh từ `../firestore.rules.tmpl` |
| `appcheck.tf` | reCAPTCHA Enterprise + App Check (chỉ ép buộc khi `enforce_app_check = true`) |
| `secrets.tf` | Khoá Gemini (giới hạn Generative Language API) trong Secret Manager |
| `function.tf` | Function `enrich`, tài khoản dịch vụ tối thiểu, bucket mã nguồn |
| `budget.tf` | Cảnh báo ngân sách 50/90/100% (tuỳ chọn) |
| `outputs.tf` | `web_env`, `android_env`, link bật đăng nhập Google |
| `deploy.mjs` | build function → terraform apply → dựng từ điển → build web → firebase hosting |

Không commit: `terraform.tfvars` (email), `terraform.tfstate` (chứa khoá Gemini). Đã nằm trong `.gitignore`.

Trạng thái kiểm chứng: `terraform fmt` và `terraform validate` đạt (CI job `terraform`). **Chưa chạy `apply` trên project thật.**
