-- =============================================================================
-- Stage 2.7-B §4-2: 夜間LLM抽出の候補を、承認フロー有効グループでは pending にする
--
-- approver_user_id が設定され *かつ* space が紐付いているグループの候補は、
-- INSERT 時点で promotion_state='pending' + requested_to_user_id=approver +
-- requested_at=now() にする（責任者確認を要求する）。
-- どちらか欠ければ 'none'（従来動作＝そのまま digest に出るだけ。承認フローはオプトイン）。
--
-- ベースは 20260715071111_ingest_lock_order.sql の最新定義
-- （関数を再定義する migration は必ず直前の最新定義を土台にする — 過去に後発ファイルが
--   認可チェックを脱落させた実害があるため）。引数シグネチャ・戻り値・on conflict・
--   grant/revoke・security definer・ロック順序（group を for update）は変更していない。
-- 変更点は「approver_user_id を読み、候補の promotion_state 系3列を条件付きで埋める」のみ。
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
  v_approver uuid;
  v_pending boolean;
  v_task jsonb;
  v_rows int;
  v_inserted int := 0;
begin
  -- ★for update: 後続の水位UPDATEに備えて最初から排他で掴む（ロック昇格＝デッドロックの回避）
  select org_id, space_id, approver_user_id into v_org_id, v_space_id, v_approver
  from public.channel_groups
  where id = p_group_id
  for update;

  if v_org_id is null then
    raise exception 'rpc_ingest_digest_tasks: unknown group_id %', p_group_id;
  end if;

  -- 承認フローの発火条件（§4-2）: approver 設定済み *かつ* space 紐付け済み。
  -- space が無い候補は昇格先が無く pending にしても確認しようがないため 'none' に留める。
  v_pending := (v_approver is not null and v_space_id is not null);

  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  loop
    insert into public.channel_digest_tasks (
      org_id, group_id, space_id, source_message_id, title,
      assignee_hint, assignee_external_user_id, assignee_identity_id,
      due_date, due_time, extracted_date,
      promotion_state, requested_to_user_id, requested_at
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
      (now() at time zone 'Asia/Tokyo')::date,
      case when v_pending then 'pending' else 'none' end,
      case when v_pending then v_approver else null end,
      case when v_pending then now() else null end
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
--   旧定義（promotion_state を埋めない）へ戻すと、承認フロー有効グループでも候補が
--   'none' で入り、責任者確認を経ずに従来の消し込み対象になってしまう。戻さないこと。
-- =============================================================================
