# 共有DB × supabase/migrations 棚卸しレポート（2026-07-05）

## 背景

共有Supabase（bbkguncomaizevkgxkwx）は CLI の migration 管理外で、これまで個別に psql 適用してきた。
本日の UX 監査で `_create_task_notification` 未適用（既存 `rpc_pass_ball` が実行時エラーになる状態）が見つかったため、全 migration とDBの差分を棚卸しした。

## 監査方法

全63ファイルを **1トランザクション内で時系列リプレイ**（ファイルごとに SAVEPOINT、エラー時はそのファイルだけ巻き戻し）し、リプレイ前後のスキーマスナップショット（関数定義md5・ACL・テーブル・カラム・インデックス・ポリシー・トリガー）を比較。最後に ROLLBACK するため**実DBは一切変更しない**。スクリプト: セッションscratchpad `replay_audit2.py`（必要なら再作成可能な手法として本書に記録）。

## 発見された差分（適用前）

### 未適用だった関数（9件）— 機能・整合性ガードの欠落
| 関数 | 由来 | 影響 |
|------|------|------|
| `rpc_parse_meeting_minutes` / `rpc_get_minutes_preview` | 20240206_000_minutes_parser | **議事録パーサー（AT-005）がDBレベルで動かない** |
| `process_scheduling_expirations` / `process_scheduling_reminders` | 20260216_000_scheduling_cron | 日程調整の期限切れ・リマインダー処理が不在 |
| `rpc_create_space_with_preset` | 20260219_000_preset_genre | プリセット付きプロジェクト作成が不在 |
| `enforce_review_gate`（＋トリガー） | 20260703_000_collab_notifications | **レビュー未承認タスクの完了防止ゲートが不在** |
| `check_task_parent_hierarchy` / `prevent_space_id_change`（＋トリガー） | 20260310_000_multi_level_hierarchy | サブタスク階層の整合性ガードが不在 |
| `guard_portal_visible_sections`（＋トリガー） | 20260307_001_portal_sections_write_guard | ポータル公開設定の書き込みガードが不在 |

### 未適用だったテーブル/カラム
- `scheduling_reminder_log`（テーブル・インデックス3件）
- `spaces.preset_genre`

### 定義が古かった関数（6件）
`guard_agency_settings` / `guard_task_pricing_write` / `guard_task_pricing_delete` / `rpc_get_org_members` / `rpc_is_superadmin` / `rpc_create_invite`、＋ACLドリフト `rpc_confirm_proposal_slot`

### rpc_create_invite の複合問題（Critical）
1. **anon に EXECUTE 付与** — 未ログインで呼び出し可能だった
2. **`p_created_by` を無検証で信頼** — 管理者IDを渡せばなりすまし招待が可能（クライアントが自分を admin 招待する権限昇格経路）
3. リポジトリ側のリグレッション: `20260317_000_invite_90_days.sql` が 20240103 の owner/admin 認可チェックを**落として**再定義していた（90日化と引き換えに認可が消失）

→ `20260705135847_rpc_create_invite_authz.sql` で `auth.uid() = p_created_by` 強制＋owner/admin チェック復元＋anon/public 剥奪。ROLLBACKトランザクション内で3ケース検証済み（匿名→拒否 / なりすまし→拒否 / 正規owner→成功）。

## 実施した是正（すべて適用済み・再監査でドリフト解消を確認）

時系列順に個別適用（`psql -1 -v ON_ERROR_STOP=1`）:
```
20240206_000_minutes_parser
20260216_000_scheduling_cron
20260217_000_scheduling_security_fixes
20260219_000_preset_genre
20260221_000_apply_preset
20260223_000_rpc_get_org_members
20260305_000_admin_superadmin
20260307_001_portal_sections_write_guard
20260308_002_agency_settings_write_guard
20260308_003_task_pricing_write_guard
20260310_000_multi_level_hierarchy
20260703_000_collab_notifications
20260703_008_rls_invites
20260703_009_rpc_authz_hardening   （008が古い定義で上書きするため再適用）
20260705133733_rpc_review_open_internal_reviewers （同上・最新に復元）
20260704161919_rpc_authz_org_invite（再適用）
20260705084441_rpc_accept_invite_service_role_only（再適用）
20260317_000_invite_90_days
20260705135847_rpc_create_invite_authz（新規）
20260705140008_migration_log（新規）
```

## 再発防止

1. **適用記録テーブル `applied_migrations`** を新設し、全65ファイルをバックフィル済み。今後 psql で migration を適用したら必ず1行 INSERT する:
   ```bash
   psql "$SUPABASE_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/<file>
   psql "$SUPABASE_DB_URL" -c "insert into applied_migrations (filename) values ('<file>') on conflict do nothing;"
   ```
2. **後発ファイルが関数を古い定義で再定義していないか**に注意（今回 20260703_008 → 20260704161919 の順序逆転、20260317 の認可チェック脱落の2件が実害化）。関数を再定義する migration は「直前の最新定義」を必ず土台にする。

## リポジトリ衛生（未対応・低優先）

リプレイで再実行できないファイルが2件ある（DBには適用済みで実害なし。ただし新環境構築時に問題になる）:
- `20240205_000_meeting_end_trigger.sql` — `||` 付近の構文エラーで単体再実行不可
- `20240208_000_task_comments.sql` — `column "user_id" does not exist`（適用順依存）

そのほか17件は IF NOT EXISTS ガードの無い CREATE POLICY / CREATE TABLE により再実行不可（適用済みのため実害なし）。新環境をゼロから作る場合は冪等化リファクタが必要。
