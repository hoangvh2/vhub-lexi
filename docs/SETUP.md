# Cài đặt và triển khai

Làm theo thứ tự. Các bước **TAY** là việc Terraform không làm thay được.

## 0. Cần chuẩn bị

- Một project Google Cloud **mới** cho Lexi, đã gắn billing (Cloud Functions cần gói Blaze), bạn là Owner. Ghi lại **Project ID**.
- Quyền sửa DNS của `vhub.id.vn`.
- Công cụ: Terraform ≥ 1.10, `gcloud`, Node 22, (Android) JDK 17.

## 1. Cấu hình

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars   # không commit
# sửa: project_id, allowed_emails, custom_domain = "lexi.vhub.id.vn"
```

## 2. Deploy (Terraform + web)

```bash
node infra/deploy.mjs
```

Việc script làm: build + test function → `terraform apply` (API, Firebase, Firestore + rules từ `firestore.rules.tmpl`, App Check, Secret Manager, Gemini key, function `enrich`, budget nếu có) → dựng từ điển → build web với cấu hình Terraform xuất ra → `firebase deploy --only hosting`. Lần đầu sẽ mở trình duyệt để đăng nhập `gcloud` và Firebase CLI.

**Chỉ deploy lại web (nhanh):** `node infra/deploy.mjs --web-only` bỏ qua function, Terraform và gcloud; dùng lại `node_modules`, từ điển đã dựng và cấu hình lưu từ lần chạy đầy đủ gần nhất (`infra/.build/outputs.json`). Thêm `--skip-tests` để bỏ qua test web.

**TAY (một lần):** Firebase Console → Authentication → Get started → bật nhà cung cấp **Google**. Link được in cuối lệnh deploy.

## 3. Nối `lexi.vhub.id.vn` (TAY)

1. Firebase Console → Hosting → *Add custom domain* → `lexi.vhub.id.vn`.
2. Thêm **đúng** các bản ghi DNS Console hiện ra (TXT xác minh + A hoặc CNAME) tại nhà đăng ký `.id.vn`. Một tên không thể vừa có CNAME vừa có bản ghi khác.
3. Authentication → Settings → *Authorized domains* → thêm `lexi.vhub.id.vn`.
4. Google Cloud Console → APIs & Services → Credentials → OAuth client loại *Web* (Firebase tạo): thêm *Authorized JavaScript origins* `https://lexi.vhub.id.vn` và *redirect URI* `https://lexi.vhub.id.vn/__/auth/handler`.
5. Đặt `custom_domain = "lexi.vhub.id.vn"` trong `terraform.tfvars` rồi chạy lại `node infra/deploy.mjs --yes` (cập nhật miền cho App Check và CORS của function).

Thiếu bước 3–5 sẽ gặp `auth/unauthorized-domain` hoặc lỗi CORS khi gọi AI. Thời gian cấp chứng chỉ HTTPS sau khi DNS đúng: không cố định, nên làm bước DNS sớm.

## 4. Android

1. Lấy SHA-1 của khoá ký: bản CI dùng `android/keystore/sideload.jks`, SHA-1 = `02:B4:AA:71:44:81:2C:5F:C6:73:0B:59:E1:07:85:67:F8:88:D1:69`. Thêm vào `terraform.tfvars`: `android_sha1 = ["02:B4:…:69"]` (thêm SHA-1 của khoá debug nếu cần chạy bản debug), deploy lại.
2. `terraform -chdir=infra output android_env` in `FIREBASE_*`. **TAY:** `FIREBASE_WEB_CLIENT_ID` là *OAuth client ID loại Web* của project (Credentials), không in ra được.
3. GitHub → Settings → Secrets and variables → Actions → **Variables**: đặt `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID`, `FIREBASE_WEB_CLIENT_ID`, `FUNCTIONS_REGION`. Workflow `Android` build APK (artifact `Lexi-apk`); cài đặt: tải APK, cho phép cài từ nguồn không rõ.
4. Build cục bộ (cần Android SDK):

```bash
node tools/dict/build.ts --copy-android
cd android && FIREBASE_API_KEY=… FIREBASE_APP_ID=… FIREBASE_PROJECT_ID=… FIREBASE_SENDER_ID=… FIREBASE_WEB_CLIENT_ID=… ./gradlew :app:assembleRelease
```

Không đặt biến Firebase thì APK chạy chế độ chỉ-trên-máy.

## 5. Phát triển cục bộ

```bash
node tools/dict/build.ts --copy-web
cd web && npm ci && npm run dev                 # chế độ chỉ-trên-máy
npm test                                        # unit
cd ../tests && npm ci && npm run rules          # rules trên emulator Firestore (cần Java)
cd ../web && npm run build && cd ../tests && npm run e2e   # e2e (cần playwright: npm i --no-save playwright)
cd ../android && ./gradlew :core:test           # test lõi Kotlin (không cần Android SDK)
```

Sinh lại vector sau khi đổi hành vi lõi: `cd web && UPDATE_VECTORS=1 npx vitest run test/vectors.test.ts`.

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `auth/unauthorized-domain` | Chưa thêm host vào Authorized domains | Bước 3.3 |
| Đăng nhập xong báo "Tài khoản chưa được cấp quyền" | Email không có trong `allowed_emails` | Sửa tfvars, deploy lại |
| Gọi AI báo lỗi CORS | Host hiện tại chưa nằm trong `custom_domain` đã deploy | Bước 3.5 |
| Android: "Đăng nhập Google không thành công" | SHA-1 khoá ký chưa đăng ký hoặc thiếu `FIREBASE_WEB_CLIENT_ID` | Bước 4.1–4.2 |
| Tra từ không ra gì | Gói từ điển chưa dựng/copy | `node tools/dict/build.ts --copy-web` (hoặc `--copy-android`) |
