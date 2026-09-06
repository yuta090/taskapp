# 認証メール（会員登録の確認・パスワード再設定など）を当社の文面で送る設定

会員登録の確認・パスワード再設定・ログイン用リンク・メールアドレス変更確認のメールは、
既定では Supabase（認証基盤）が自前の文面で送ります。管理画面「メール文面 > 会員登録・ログイン」の
文面を使うには、Supabase の **Send Email Hook** を当社の受け口に向けます（一度だけの設定）。

設定するまでは Supabase の従来メールがそのまま届くので、後退はありません。

> **困ったらまずこれ**: Supabase ダッシュボード → Authentication → Hooks → Send Email を **Disable**。
> それだけで Supabase の従来メールに戻ります（コード変更・デプロイ不要）。

方針: 当社側の送信に失敗したときは Supabase に 500 を返し、その場の認証操作（登録・再設定）をエラーにします。
黙って成功にして「メールが来るはず」と待たせるより、すぐエラーが見えて再試行できる方を選んでいます。
Resend への送信は 8 秒で打ち切ります（Supabase 側のタイムアウトより先に返すため）。

## 手順（本番）

1. Supabase ダッシュボード → プロジェクト `bbkguncomaizevkgxkwx` → **Authentication → Hooks**
2. **Send Email** を「Enable」→ 種類 **HTTPS**
3. URL: `https://agentpm.app/api/auth/send-email-hook`
4. **Generate secret** で秘密を作り、表示された値（`v1,whsec_...`）をコピー
5. Vercel の本番環境変数に `SEND_EMAIL_HOOK_SECRET=<コピーした値>` を追加して再デプロイ
   （先に環境変数を入れてから Hook を有効にすると、切替の瞬間も 503 にならない）
6. 動作確認: ログイン画面の「パスワードを忘れた」で自分のアドレスに送り、受信箱で
   当社の文面（管理画面の内容）になっていることを確認する

## 仕組み

- Supabase がメールを送る代わりに、署名付き（Standard Webhooks）で受け口へ POST する
- 受け口 `src/app/api/auth/send-email-hook/route.ts` が署名を検証し、`src/lib/email/sendAuthEmail.ts` が
  管理画面の文面（`email_templates`、無ければコード既定）で Resend から送る
- 確認リンクは従来と同じ Supabase の `/auth/v1/verify?...` で、文面からは変えられない
- 対応する種類: `signup` / `recovery` / `magiclink`・`email`（ログイン用リンク） / `email_change`（旧・新の2通に分けて送る） / `invite`。
  それ以外（`reauthentication` の再認証コードなど）は確認コードだけの簡易文面で送り、ログに `unhandled email_action_type` を出す

## 困ったとき

- メールが届かない・ログイン操作がエラーになる → Vercel のログで `[send-email-hook]` を確認。
  `503` は環境変数未設定、`401` は秘密の不一致（Hook 画面で秘密を再生成して環境変数を更新）
- 一時的に Supabase の従来メールに戻したい → Hook を Disable にするだけ（コード変更不要）
