import { useState } from "preact/hooks";
import { signInGoogle, signOutUser } from "../data/firebase.ts";
import { Icon } from "./common.tsx";

export function LoginGate({ busy }: { busy: boolean }) {
  const [err, setErr] = useState("");
  const [working, setWorking] = useState(false);
  return (
    <div class="gate">
      <div class="panel">
        <div class="brand"><i>L</i>VH Lexi</div>
        <p class="muted">Học từ vựng tiếng Anh bằng flashcard và lặp lại ngắt quãng. Đăng nhập để đồng bộ giữa điện thoại và máy tính.</p>
        <button
          type="button"
          class="btn primary"
          disabled={busy || working}
          data-testid="login"
          onClick={async () => {
            setErr("");
            setWorking(true);
            try {
              await signInGoogle();
            } catch (e) {
              const code = (e as { code?: string }).code ?? "";
              setErr(code === "auth/unauthorized-domain" ? "Tên miền này chưa được khai báo trong Firebase Authentication." : "Không đăng nhập được. Thử lại sau.");
            } finally {
              setWorking(false);
            }
          }}
        >
          {busy ? "Đang kiểm tra…" : "Đăng nhập với Google"}
        </button>
        {err && <p class="muted" style={{ color: "var(--again)" }} role="alert">{err}</p>}
      </div>
    </div>
  );
}

export function DeniedGate({ email }: { email: string | null }) {
  return (
    <div class="gate">
      <div class="panel">
        <div class="brand"><i>L</i>VH Lexi</div>
        <h2>Tài khoản chưa được cấp quyền</h2>
        <p class="muted">{email ? `${email} không nằm trong danh sách được phép dùng ứng dụng này.` : "Tài khoản này không nằm trong danh sách được phép."} Đăng xuất và dùng tài khoản khác.</p>
        <button type="button" class="btn" onClick={() => void signOutUser()}><Icon n="logout" /> Đăng xuất</button>
      </div>
    </div>
  );
}
