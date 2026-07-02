# メール承認機能 — 残タスク

## 環境変数設定（未完了）

### Vercel（本番）
- [ ] `RESEND_API_KEY` — Resend ダッシュボードから取得して Vercel に設定
- [ ] `FROM_EMAIL` — Resend で認証済みドメインの送信元アドレス（例: `noreply@yourdomain.com`）

### ローカル（.env.local）
- [ ] `RESEND_API_KEY`
- [ ] `FROM_EMAIL`

## 後回しにした機能
- [ ] 期限切れトークンの定期クリーンアップ cron（`email_action_tokens` の `expires_at` 超過 & `used_at IS NULL` を削除）

## 動作確認
- [ ] ボール → クライアント移動時にメール送信されることを確認
- [ ] メール内リンクから確認ページが表示されることを確認
- [ ] ワンクリック承認が正常に動作することを確認（タスク承認 / 見積もり承認）
- [ ] Slack通知が発火されることを確認
- [ ] トークン有効期限切れ時のエラー表示を確認
- [ ] トークン再利用時のエラー表示を確認
