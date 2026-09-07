# 二要素認証（認証アプリ・TOTP）

## 利用者側
- 設定 → アカウント → 「二要素認証（認証アプリ）」→ 有効にする → QR を認証アプリで読み取り → 6桁コードで確認。
- 以後のログインは、パスワード（or Google）→ `/login/mfa` でコード入力 → アプリへ。
- 解除は同じ画面から（直前にコード確認が要る）。

## 仕組み
- Supabase Auth の MFA（TOTP）。ログイン直後は aal1、コード確認後に aal2。
- 門番: `src/proxy.ts` が保護ページで `getAuthenticatorAssuranceLevel()` を見て、登録済み×aal1 なら `/login/mfa?redirect=…` へ回す（判定は `src/lib/auth/mfa.ts` の純粋関数）。
- 運営画面 `src/app/admin/(panel)/layout.tsx` でも同じ判定を二重に行う。`ADMIN_MFA_REQUIRED=true` を Vercel に入れると、認証アプリ未登録の運営は入れない（設定画面へ案内）。**運営が登録してから有効にすること**。

## 認証アプリを失くした人の復旧
- 運営が本人確認（電話・既知のメール等）のうえ、管理画面 ユーザー管理 → その人の行の「2FA解除」を押す（`POST /api/admin/users/mfa-reset`。factor を全部削除）。
- 運営自身が失くした場合: 別の運営に解除してもらう。運営が1人しかいない場合は Supabase ダッシュボード → Authentication → Users → 該当ユーザー → MFA factors から削除。

## Stripe 審査への回答
- 「② 二要素認証等による本人確認」に該当。あわせて「④ ログイン試行回数の制限」（Supabase 標準のレート制限）と「⑤ ログイン時のメール通知」（新しい端末からのログイン通知）も実装済み。
