-- =============================================================================
-- AI秘書 Stage 4 PR4 メータリング Fix3: 集計は status='sent' の billable_push 行のみ
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3(使用量メータリング骨格) / §7-10
--
-- 敵対的レビュー（Opus code-reviewer + Codex GPT）で収束したcritical指摘:
-- console手動送信(POST /api/channels/messages)は「証跡が先、送信が後」の設計のため、
-- billable_push=true の行を status='queued' で先にINSERTし、pushLineMessage成功後に
-- status='sent' へ更新する。push が失敗した場合は status='failed' に更新されるが、
-- billable_push列自体は true のまま残る。
--
-- 20260716175640/175641（billable_push列・集計関数。ともに変更禁止・forward migrationで
-- 上書きする）の集計は billable_push だけを見て status を無視していたため、
-- 「LINEに実際には届かなかった(failed)・まだ送信していない(queued)」pushまで
-- 無料枠を消費したものとして課金カウントしてしまい、実消費量を過大に見積もっていた
-- （＝実際には枠が余っているのに hard/soft へ誤って遷移し、正当な配信を抑止し得る）。
--
-- 対策: 実際に送信成功した行（status='sent'）のみを集計対象にする。queued/failedは
-- 無料枠を消費していないため集計から除外する。
--
-- create or replace のみ・列/インデックス追加は無し（純粋にクエリ条件の追加）。
-- =============================================================================

create or replace function public.app_org_channel_push_usage_current_month(p_org uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_cnt bigint;
begin
  if not public.app_is_org_internal(p_org) then
    raise exception 'app_org_channel_push_usage_current_month: forbidden' using errcode = '42501';
  end if;
  select month_from, month_to into v_from, v_to from public.app_jst_current_month_bounds();
  select count(*) into v_cnt
    from public.channel_messages m
    where m.billable_push
      and m.status = 'sent'
      and m.org_id = p_org
      and m.occurred_at >= v_from
      and m.occurred_at < v_to;
  return v_cnt;
end;
$$;

revoke all on function public.app_org_channel_push_usage_current_month(uuid) from public, anon;
grant execute on function public.app_org_channel_push_usage_current_month(uuid) to authenticated;

create or replace function public.app_refresh_channel_metering_state()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_cnt bigint;
  v_new text;
  v_updated integer := 0;
  r record;
begin
  select month_from, month_to into v_from, v_to from public.app_jst_current_month_bounds();

  for r in
    select org_id, monthly_push_quota
    from public.org_channel_policy
    where monthly_push_quota is not null
  loop
    select count(*) into v_cnt
      from public.channel_messages m
      where m.billable_push
        and m.status = 'sent'
        and m.org_id = r.org_id
        and m.occurred_at >= v_from
        and m.occurred_at < v_to;

    v_new := case
      when v_cnt >= r.monthly_push_quota then 'hard'
      when v_cnt >= ceil(r.monthly_push_quota * 0.8) then 'soft'
      else 'ok'
    end;

    update public.org_channel_policy
      set state = v_new, updated_at = now()
      where org_id = r.org_id and state is distinct from v_new;
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  -- 無制限（quota NULL）の org は state を既定 'ok' に戻す（quota を後から外した場合の追従）。
  update public.org_channel_policy
    set state = 'ok', updated_at = now()
    where monthly_push_quota is null and state is distinct from 'ok';
  get diagnostics v_cnt = row_count;
  v_updated := v_updated + v_cnt;

  return v_updated;
end;
$$;

revoke all on function public.app_refresh_channel_metering_state() from public, anon, authenticated;

-- =============================================================================
-- 検証（適用後・service role）:
--   1) billable_push=true かつ status='queued'/'failed' の行は当月カウントに入らないこと。
--   2) billable_push=true かつ status='sent' の行のみカウントされること（既存挙動と同じ閾値遷移）。
--   3) app_org_channel_push_usage_current_month も同じ条件で数え、他org呼び出しで 42501 のまま。
-- ロールバック:
--   20260716175641_shared_bot_metering_state_cron.sql の該当2関数定義をそのまま
--   create or replace で再適用する（statusフィルタを外す）。
-- =============================================================================
