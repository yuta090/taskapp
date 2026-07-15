-- rpc_ingest_digest_tasks の pending 生成の受け入れ条件（Stage 2.7-B §4-2）。
set client_min_messages = notice;

do $$
declare
  v_org   uuid := '00000000-0000-4000-8000-000000000001';
  v_appr  uuid := '00000000-0000-4000-8000-0000000000a1';
  v_g1    uuid := '00000000-0000-4000-8000-0000000000d1'; -- approver+space
  v_g2    uuid := '00000000-0000-4000-8000-0000000000d2'; -- approver無
  v_g3    uuid := '00000000-0000-4000-8000-0000000000d3'; -- space無
  v_wm    timestamptz := '2026-07-15T00:00:00Z';
  v_n     int;
  r       record;
begin
  -----------------------------------------------------------------------------
  -- 1) approver + space あり → 候補は pending・requested_to=approver・requested_at 有り
  -----------------------------------------------------------------------------
  select rpc_ingest_digest_tasks(v_g1, v_wm, jsonb_build_array(
    jsonb_build_object('source_message_id', gen_random_uuid()::text, 'title', '酒屋へ発注')
  )) into v_n;
  if v_n <> 1 then raise exception '1) inserted=% (期待 1)', v_n; end if;

  select * into r from channel_digest_tasks where group_id = v_g1 and title = '酒屋へ発注';
  if r.promotion_state <> 'pending' then raise exception '1) state=% (期待 pending)', r.promotion_state; end if;
  if r.requested_to_user_id <> v_appr then raise exception '1) requested_to が approver でない'; end if;
  if r.requested_at is null then raise exception '1) requested_at が null'; end if;
  raise notice 'PASS 1) approver+space → pending（requested_to=approver）';

  -----------------------------------------------------------------------------
  -- 2) approver なし → 従来どおり none（承認フローはオプトイン）
  -----------------------------------------------------------------------------
  select rpc_ingest_digest_tasks(v_g2, v_wm, jsonb_build_array(
    jsonb_build_object('source_message_id', gen_random_uuid()::text, 'title', '請求書送付')
  )) into v_n;
  select * into r from channel_digest_tasks where group_id = v_g2 and title = '請求書送付';
  if r.promotion_state <> 'none' then raise exception '2) state=% (期待 none)', r.promotion_state; end if;
  if r.requested_to_user_id is not null then raise exception '2) none なのに requested_to が埋まっている'; end if;
  raise notice 'PASS 2) approver未設定 → none（従来動作）';

  -----------------------------------------------------------------------------
  -- 3) approver あるが space なし → none（昇格先が無いため pending にしない）
  -----------------------------------------------------------------------------
  select rpc_ingest_digest_tasks(v_g3, v_wm, jsonb_build_array(
    jsonb_build_object('source_message_id', gen_random_uuid()::text, 'title', '住所変更')
  )) into v_n;
  select * into r from channel_digest_tasks where group_id = v_g3 and title = '住所変更';
  if r.promotion_state <> 'none' then raise exception '3) state=% (期待 none)', r.promotion_state; end if;
  raise notice 'PASS 3) space未紐付け → none（昇格先が無い）';

  -----------------------------------------------------------------------------
  -- 4) 水位が更新される
  -----------------------------------------------------------------------------
  if (select last_extracted_message_created_at from channel_groups where id = v_g1) <> v_wm then
    raise exception '4) 水位が更新されていない';
  end if;
  raise notice 'PASS 4) 抽出水位が更新される';

  -----------------------------------------------------------------------------
  -- 5) 冪等: 同一 (source_message_id, title) の再取り込みは重複を作らず状態も変えない
  -----------------------------------------------------------------------------
  declare v_smid uuid := gen_random_uuid();
  begin
    perform rpc_ingest_digest_tasks(v_g1, v_wm, jsonb_build_array(
      jsonb_build_object('source_message_id', v_smid::text, 'title', '棚卸し')));
    -- 一度 pending を承認済み(promoted)相当に手で進めておく（再取り込みで戻らないことを見る）
    update channel_digest_tasks
      set promotion_state='promoted', confirmed_by_user_id=v_appr, confirmed_at=now(),
          promoted_task_id=gen_random_uuid()
      where source_message_id=v_smid and title='棚卸し';
    select rpc_ingest_digest_tasks(v_g1, v_wm, jsonb_build_array(
      jsonb_build_object('source_message_id', v_smid::text, 'title', '棚卸し'))) into v_n;
    if v_n <> 0 then raise exception '5) 再取り込みで inserted=% (期待 0)', v_n; end if;
    select count(*) into v_n from channel_digest_tasks where source_message_id=v_smid and title='棚卸し';
    if v_n <> 1 then raise exception '5) 重複行ができた count=%', v_n; end if;
    if (select promotion_state from channel_digest_tasks where source_message_id=v_smid and title='棚卸し') <> 'promoted' then
      raise exception '5) 再取り込みで状態が巻き戻った';
    end if;
  end;
  raise notice 'PASS 5) 冪等（on conflict do nothing・状態を巻き戻さない）';

  raise notice '=== 全項目 PASS ===';
end $$;
