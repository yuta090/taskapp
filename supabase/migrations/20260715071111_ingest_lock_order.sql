-- =============================================================================
-- fix: rpc_ingest_digest_tasks のロック昇格を解消する（デッドロック回避）
--
-- 20260714165651_backfill_identity_space_scope.sql で、channel_digest_tasks /
-- channel_messages に BEFORE INSERT の導出トリガーを入れた。これは group を
-- `for share` で読む（リンク処理とのすれ違いを直列化するため）。
--
-- ところが rpc_ingest_digest_tasks は
--   子行(channel_digest_tasks)をINSERT → 同じ group の抽出水位をUPDATE
-- という順序で動くため、「共有ロック → 排他ロックへの昇格」が起きる。
--
-- ここで rpc_link_group_to_space（group を先にUPDATEする）との間に待機の循環が成立し、
-- デッドロックでどちらかが中止される。リンクが犠牲になるとグループ紐付け自体が失敗する。
--
--   ingest Tx : group を for share ─→ 子行INSERT ─→ group を UPDATE（昇格：linkを待つ）
--   link   Tx : group を UPDATE（ingestの共有ロックを待つ）
--   → 相互待機
--
-- 対策: ingest の冒頭で group を `for update` で掴み、ロック順序を常に
-- 「group → 子行」に統一する。以後トリガーの for share は既に保持している強いロックで
-- 満たされるため、昇格そのものが起きない。
--
-- 本番DBでは2セッションを実際に交差させ、デッドロックが起きず両方完了することを検証済み
-- （ingest→link / link→ingest の双方向）。
--
-- ベースは 20260714153028_digest_due_assignee.sql の最新定義
-- （関数を再定義する migration は必ず直前の最新定義を土台にする — 過去に後発ファイルが
--   認可チェックを脱落させた実害があるため）。引数シグネチャ・戻り値・INSERT列・
--   on conflict・grant/revoke・security definer は変更していない。
-- =============================================================================

create or replace function public.rpc_ingest_digest_tasks(
  p_group_id uuid,
  p_new_watermark timestamptz,
  p_tasks jsonb
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_space_id uuid;
  v_task jsonb;
  v_rows int;
  v_inserted int := 0;
begin
  -- ★for update: 後続の水位UPDATEに備えて最初から排他で掴む（ロック昇格＝デッドロックの回避）
  select org_id, space_id into v_org_id, v_space_id
  from public.channel_groups
  where id = p_group_id
  for update;

  if v_org_id is null then
    raise exception 'rpc_ingest_digest_tasks: unknown group_id %', p_group_id;
  end if;

  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  loop
    insert into public.channel_digest_tasks (
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

  update public.channel_groups
  set last_extracted_message_created_at = p_new_watermark
  where id = p_group_id;

  return v_inserted;
end;
$$;

revoke execute on function public.rpc_ingest_digest_tasks(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_ingest_digest_tasks(uuid, timestamptz, jsonb) to service_role;

-- =============================================================================
-- 巻き戻しについて（forward fix が標準手順）
--   旧定義（for update なし）へ戻すとデッドロック経路が復活する。戻さないこと。
-- =============================================================================
