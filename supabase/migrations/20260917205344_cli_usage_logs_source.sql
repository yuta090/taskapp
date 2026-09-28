-- 利用記録に「どの口から来たか」を足す。
-- cli  = ターミナルの agentpm コマンド（/api/tools）
-- mcp  = 外部チャットからのリモートMCP接続（/api/mcp）
--
-- 既存行はすべて CLI 由来なので default 'cli' で埋まる。列を足すだけで、
-- 既存の書き込み（source を送らない /api/tools）はそのまま通る。

alter table public.cli_usage_logs
  add column if not exists source text not null default 'cli';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cli_usage_logs'::regclass
      and conname = 'cli_usage_logs_source_check'
  ) then
    alter table public.cli_usage_logs
      add constraint cli_usage_logs_source_check check (source in ('cli', 'mcp'));
  end if;
end $$;

comment on column public.cli_usage_logs.source is
  'どの口から来た呼び出しか。cli=ターミナルのagentpmコマンド, mcp=外部チャットからのリモートMCP接続';

-- 口ごとの利用を数えるため（管理画面の集計）
create index if not exists idx_cli_usage_logs_source_created
  on public.cli_usage_logs(source, created_at desc);

-- ロールバック:
--   drop index if exists public.idx_cli_usage_logs_source_created;
--   alter table public.cli_usage_logs drop constraint if exists cli_usage_logs_source_check;
--   alter table public.cli_usage_logs drop column if exists source;
