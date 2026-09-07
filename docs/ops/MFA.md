# 二要素認証（認証アプリ・TOTP）

## 利用者側
- 設定 → アカウント → 「二要素認証（認証アプリ）」→ 有効にする → QR を認証アプリで読み取り → 6桁コードで確認。
- 以後のログインは、パスワード（or Google）→ `/login/mfa` でコード入力 → アプリへ。
- 解除は同じ画面から（直前にコード確認が要る）。

## いまの保護範囲（正直に）
- **画面**: 登録済みの人は、コード入力(aal2)を通らないと保護ページを開けない（`src/proxy.ts`。cookie の中身で判定する誘導）。
- **運営 API と運営画面**: `verifySuperadmin` が検証済みトークンの aal と Auth API の factor 一覧で**本当に強制**する（登録済み×aal1 は 403）。`ADMIN_MFA_REQUIRED=true` で未登録の運営も締め出す。
- **まだ強制していないところ**: 一般利用者向けの `/api/**` と、Supabase REST への直接アクセス（RLS は aal を見ていない）。パスワードを盗んだ攻撃者がコード入力前のセッションで API を直接叩く経路は残る。
  → 次の PR（Fable 裁定）で、機密性の高いテーブルから RLS に「登録済みなら aal2 必須」を `RESTRICTIVE` ポリシーとして足し、`/api/**` に共通の `checkAal2` を掛ける。

## 仕組み
- Supabase Auth の MFA（TOTP）。ログイン直後は aal1、コード確認後に aal2。
- 門番: `src/proxy.ts` が保護ページで `getAuthenticatorAssuranceLevel()` を見て、登録済み×aal1 なら `/login/mfa?redirect=…` へ回す（判定は `src/lib/auth/mfa.ts` の純粋関数）。
- 運営画面 `src/app/admin/(panel)/layout.tsx` と全運営 API は `verifySuperadminDetailed`（`src/lib/admin/verify-superadmin.ts` → `src/lib/auth/requireAal2.ts`）で判定。判定できないときは締め出す（fail-closed）。
- **出荷条件**: 運営全員が認証アプリを登録 → Vercel に `ADMIN_MFA_REQUIRED=true` → 以後、未登録の運営は入れない（設定画面へ案内）。

## 認証アプリを失くした人の復旧
- 運営が本人確認（電話・既知のメール等）のうえ、管理画面 ユーザー管理 → その人の行の「2FA解除」を押す（`POST /api/admin/users/mfa-reset`。factor を全部削除）。**実行する運営自身がコード入力済み(aal2)であること・自分自身は解除できない**。成功も拒否も `auth_event_logs`（stage `mfa_reset` / `mfa_reset_denied`）に残る（管理画面 ログ で確認）。
- 運営自身が失くした場合: 別の運営に解除してもらう。運営が1人しかいない場合は Supabase ダッシュボード → Authentication → Users → 該当ユーザー → MFA factors から削除。

## Stripe 審査への回答
- 「② 二要素認証等による本人確認」に該当。あわせて「④ ログイン試行回数の制限」（Supabase 標準のレート制限）と「⑤ ログイン時のメール通知」（新しい端末からのログイン通知）も実装済み。
