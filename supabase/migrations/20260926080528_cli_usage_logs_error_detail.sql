-- CLI / MCP ツール呼び出しが失敗したときの「本当の原因」を残す列。
--
-- 従来の error_message は「呼んだ人に返した決まった日本語」で、DBのコード・生の文言・
-- スタックはサーバーの console.error にしか出ておらず、あとから追えなかった。
-- error_detail に原因の詳細（構造化JSON）を残し、運営画面（/admin/cli-usage）だけで見られるようにする。
-- 呼んだ人（CLI / 外部チャット経由のAI）には従来どおり error_message の決まった文言しか返さない
-- （2026-07 のエラー詳細漏洩対策はそのまま。ここは運営専用の記録）。

alter table public.cli_usage_logs
  add column if not exists error_detail jsonb;

comment on column public.cli_usage_logs.error_detail is
  '失敗時の原因の詳細（name/message/status/stack/causeの構造化JSON）。運営画面(/admin/cli-usage)でのみ表示し、呼んだ人には返さない';

-- ロールバック:
--   alter table public.cli_usage_logs drop column if exists error_detail;
