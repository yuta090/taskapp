-- =============================================================================
-- AI秘書 Stage 2.6 — 申し送りの「期限（日付＋時刻）」と「担当」
-- 仕様: docs/spec/AI_SECRETARY_STAGE2_6_DUE_ASSIGNEE.md
--
-- Stage 2/2.5 の申し送り（channel_digest_tasks）はタイトルしか持っておらず、
-- 「金曜17時までに山田さんが酒屋へ発注」から期限も担当も落ちていた。
--
-- 担当は3段で持つ:
--   assignee_hint             ... 名前ラベル（常に埋まる。既存列・これまで未使用）
--   assignee_external_user_id ... LINE userId（本追加。identity未作成でも生で残す）
--   assignee_identity_id      ... channel_identities参照＝人単位の管理（既存列・これまで未使用）
--
-- LINEの mention.mentionees[].userId は「本人がプロフィール取得に同意している場合のみ」
-- webhookに含まれる。取れないメンバーは名前ラベルだけで運用し、後日friend追加された
-- タイミングで identity にバックフィルする（そのために生の userId を残す）。
-- =============================================================================

alter table public.channel_digest_tasks
  add column if not exists due_date date,
  add column if not exists due_time time,
  add column if not exists assignee_external_user_id text;

comment on column public.channel_digest_tasks.due_date is
  '期限日（JST。formatDateToLocalString で生成・toISOString禁止）。null=期限なし';
comment on column public.channel_digest_tasks.due_time is
  '期限時刻（JST）。null=終日（時刻の明示がなかった）。本体tasksがdate粒度のため時刻はdigest側に閉じる';
comment on column public.channel_digest_tasks.assignee_external_user_id is
  'メンションで取れたLINE userId。identity未作成でも生で残し、友だち追加時にassignee_identity_idへバックフィルする';

-- 期限の緊急度で並べる／期限リマインドの走査用。open かつ期限ありだけを対象にする部分索引
create index if not exists channel_digest_tasks_due_open
  on public.channel_digest_tasks(group_id, due_date, due_time)
  where status = 'open' and due_date is not null;

-- 友だち追加時のバックフィル（identity未作成のうちにメンションされた分を人へ紐付ける）用
create index if not exists channel_digest_tasks_assignee_external
  on public.channel_digest_tasks(org_id, assignee_external_user_id)
  where status = 'open' and assignee_external_user_id is not null;

-- -----------------------------------------------------------------------------
-- rpc_ingest_digest_tasks — 期限・担当を受け取れるよう拡張（引数シグネチャは不変）
-- -----------------------------------------------------------------------------
-- p_tasks: jsonb配列
--   [{source_message_id, title, assignee_hint, assignee_external_user_id,
--     assignee_identity_id, due_date, due_time}, ...]
--
-- unique(source_message_id, title) は変更しない。期限・担当は重複判定に含めない
-- （同一発言から同一タイトルが再抽出されたら、期限が違っても同一タスク）。
create or replace function public.rpc_ingest_digest_tasks(
  p_group_id uuid,
  p_new_watermark timestamptz,
  p_tasks jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_space_id uuid;
  v_task jsonb;
  v_rows int;
  v_inserted int := 0;
begin
  select org_id, space_id into v_org_id, v_space_id
  from channel_groups
  where id = p_group_id;

  if v_org_id is null then
    raise exception 'rpc_ingest_digest_tasks: unknown group_id %', p_group_id;
  end if;

  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  loop
    insert into channel_digest_tasks (
      org_id, group_id, space_id, source_message_id, title,
      assignee_hint, assignee_external_user_id, assignee_identity_id,
      due_date, due_time, extracted_date
    )
    values (
      v_org_id,
      p_group_id,
      v_space_id,
      (v_task->>'source_message_id')::uuid,
      v_task->>'title',
      v_task->>'assignee_hint',
      v_task->>'assignee_external_user_id',
      nullif(v_task->>'assignee_identity_id', '')::uuid,
      nullif(v_task->>'due_date', '')::date,
      nullif(v_task->>'due_time', '')::time,
      (now() at time zone 'Asia/Tokyo')::date
    )
    on conflict (source_message_id, title) do nothing;

    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
  end loop;

  update channel_groups
  set last_extracted_message_created_at = p_new_watermark
  where id = p_group_id;

  return v_inserted;
end;
$$;

revoke execute on function public.rpc_ingest_digest_tasks(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_ingest_digest_tasks(uuid, timestamptz, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- rpc_backfill_digest_assignee_identity — 友だち追加でidentityができた人の過去分を紐付ける
-- -----------------------------------------------------------------------------
-- メンション時点でidentityが無くても assignee_external_user_id に生のLINE userIdを
-- 残してあるため、後からidentityが作られた瞬間に人単位の管理へ昇格できる。
-- open のみ対象（done済みの履歴は書き換えない）。
create or replace function public.rpc_backfill_digest_assignee_identity(
  p_identity_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_external_id text;
  v_channel text;
  v_updated int := 0;
begin
  select org_id, external_id, channel into v_org_id, v_external_id, v_channel
  from channel_identities
  where id = p_identity_id and status = 'active';

  -- assignee_external_user_id はLINEのuserIdしか入らない。
  -- 他チャネル（emailのアドレス等）のidentityで誤って突合しないようチャネルを固定する
  if v_org_id is null or v_channel <> 'line' then
    return 0;
  end if;

  update channel_digest_tasks
  set assignee_identity_id = p_identity_id
  where org_id = v_org_id
    and status = 'open'
    and assignee_identity_id is null
    and assignee_external_user_id = v_external_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.rpc_backfill_digest_assignee_identity(uuid) from public, anon, authenticated;
grant execute on function public.rpc_backfill_digest_assignee_identity(uuid) to service_role;

-- =============================================================================
-- ロールバック手順（手動）
--   drop index if exists channel_digest_tasks_due_open;
--   drop index if exists channel_digest_tasks_assignee_external;
--   drop function if exists public.rpc_backfill_digest_assignee_identity(uuid);
--   alter table public.channel_digest_tasks
--     drop column if exists due_date,
--     drop column if exists due_time,
--     drop column if exists assignee_external_user_id;
--   （rpc_ingest_digest_tasks は 20260711073329 の create or replace を再適用して戻す）
-- =============================================================================
