-- =============================================================================
-- sink outbox: 「defer」outcome の追加（インフラ一時障害を attempt 予算から除外する）
--
-- 【背景 / Fable 裁定 2026-07-23】
-- 平文トークン是正PR(#376)で、復号 RPC/vault の一時障害を throw→transient_error→dispatcher の
-- temporary_fail(再試行) に載せた。しかし temporary_fail は attempt 予算(バックオフ表 5段+1=最大6試行、
-- 約8.6h)を消費し、持続すると個別配達が dead(永久喪失)になる。「主DBは健全だが復号 RPC/vault だけが
-- 一時的に落ちる」障害モードでは、**配達を試みる前の失敗(自分のDB/秘密が読めない)**は配達先が拒否した
-- のとは違い、attempt 予算を消費すべきでない。これを新 outcome 'defer' として入れる。
-- これは M2(20260723110840_empty_plaintext_connection_tokens.sql の平文空化)の必須 precondition。
--
-- 【この migration の内容】
-- rpc_complete_sink_delivery を create or replace で差し替え、**シグネチャは不変**
-- (uuid, text, int, text, boolean)。既存の 'sent'/'temporary_fail'/'permanent_fail' の挙動は一切
-- 変えず、'defer' 分岐だけを足す。
--
-- 【'defer' の挙動】
--   - attempts を **増やさない**(これが肝。予算を消費しない)。
--   - status='failed'、next_attempt_at = now() + interval '5 minutes'(固定短ディレイ)、last_error 記録。
--   - **consecutive_failures は加算する**(無限リトライの歯止め)。持続障害では従来どおり 20連続で
--     sink 自動停止(status='error')＋通知(just_became_error)が発火し、復旧後 rpc_reactivate_sink で
--     attempt 無傷のまま再開できる。※defer は circuit breaker のため p_counts_toward_failures に
--     関わらず**常に**加算する(呼び出し側 dispatcher も true を渡す)。
--
-- 【冪等・可逆】create or replace のみ。ロールバックは 20260711121910 の定義を再適用すれば戻る
--   ('defer' を渡さなくなるだけで既存 outcome は不変のため、コードデプロイ順に依存しない)。
--
-- 【適用】本番未適用(このPRでは作成のみ)。実適用は「本コード＋M1 → 本 defer PR → M2 → M3」の順。
-- =============================================================================

create or replace function public.rpc_complete_sink_delivery(
  p_delivery_id uuid,
  p_outcome text,
  p_response_status int,
  p_error text,
  p_counts_toward_failures boolean
)
returns table (
  delivery_status text,
  sink_status text,
  consecutive_failures int,
  just_became_error boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sink_id uuid;
  v_attempts int;
  v_new_status text;
  v_backoff_minutes int[] := array[1, 5, 30, 120, 360];
  v_delay_minutes int;
  v_sink_status text;
  v_consecutive_failures int;
  v_prev_sink_status text;
  v_just_became_error boolean := false;
begin
  select sink_id, attempts into v_sink_id, v_attempts
  from sink_deliveries where id = p_delivery_id
  for update;

  if v_sink_id is null then
    raise exception 'rpc_complete_sink_delivery: unknown delivery_id %', p_delivery_id;
  end if;

  if p_outcome = 'sent' then
    update sink_deliveries
    set status = 'sent',
        delivered_at = now(),
        attempts = attempts + 1,
        response_status = p_response_status,
        last_error = null
    where id = p_delivery_id;

    v_new_status := 'sent';

    -- isk別名で明示修飾する: returns table(...)のOUT列名consecutive_failuresが
    -- 同名のplpgsql変数を暗黙宣言するため、非修飾の列参照は
    -- integration_sinks.consecutive_failures と曖昧衝突しSQLエラーになる。
    update integration_sinks isk
    set consecutive_failures = 0, last_delivered_at = now()
    where isk.id = v_sink_id
    returning isk.status, isk.consecutive_failures into v_sink_status, v_consecutive_failures;

  elsif p_outcome = 'defer' then
    -- インフラ一時障害: attempts は増やさない(予算を消費しない)。status=failed で 5分後に再試行。
    -- next_attempt_at は defer 専用の固定短ディレイ(バックオフ表を進めない)。
    update sink_deliveries
    set status = 'failed',
        next_attempt_at = now() + interval '5 minutes',
        response_status = p_response_status,
        last_error = left(coalesce(p_error, ''), 500)
    where id = p_delivery_id;

    v_new_status := 'failed';

    -- consecutive_failures は加算する(無限 defer の歯止め=circuit breaker)。
    -- defer は p_counts_toward_failures に関わらず常に加算する。
    select isk.status into v_prev_sink_status from integration_sinks isk where isk.id = v_sink_id for update;

    update integration_sinks isk
    set consecutive_failures = isk.consecutive_failures + 1
    where isk.id = v_sink_id
    returning isk.status, isk.consecutive_failures into v_sink_status, v_consecutive_failures;

    -- 20連続で停止(temporary_fail 経路と同一の閾値・文言に揃える)。
    if v_consecutive_failures >= 20 and v_prev_sink_status = 'active' then
      update integration_sinks set status = 'error' where id = v_sink_id;
      v_sink_status := 'error';
      v_just_became_error := true;
    end if;

  else
    v_attempts := v_attempts + 1;

    if p_outcome = 'permanent_fail' then
      v_new_status := 'dead';
    elsif v_attempts >= array_length(v_backoff_minutes, 1) + 1 then
      v_new_status := 'dead';
    else
      v_delay_minutes := v_backoff_minutes[least(v_attempts, array_length(v_backoff_minutes, 1))];
      v_new_status := 'failed';
    end if;

    update sink_deliveries
    set status = v_new_status,
        attempts = v_attempts,
        next_attempt_at = case
          when v_new_status = 'failed' then now() + (v_delay_minutes || ' minutes')::interval
          else next_attempt_at
        end,
        response_status = p_response_status,
        last_error = left(coalesce(p_error, ''), 500)
    where id = p_delivery_id;

    select isk.status into v_prev_sink_status from integration_sinks isk where isk.id = v_sink_id for update;

    if p_counts_toward_failures then
      -- 同上: isk別名で明示修飾しないとconsecutive_failuresがOUT列名と曖昧衝突する
      update integration_sinks isk
      set consecutive_failures = isk.consecutive_failures + 1
      where isk.id = v_sink_id
      returning isk.status, isk.consecutive_failures into v_sink_status, v_consecutive_failures;

      -- 20連続失敗で停止（m5: >20だと21回目まで発火せず「20連続失敗」の文言・通知と
      -- ズレるため、ちょうど20回目の失敗で発火する >= 20 に統一する）
      if v_consecutive_failures >= 20 and v_prev_sink_status = 'active' then
        update integration_sinks set status = 'error' where id = v_sink_id;
        v_sink_status := 'error';
        v_just_became_error := true;
      end if;
    else
      select isk.status, isk.consecutive_failures into v_sink_status, v_consecutive_failures
      from integration_sinks isk where isk.id = v_sink_id;
    end if;
  end if;

  return query select v_new_status, v_sink_status, v_consecutive_failures, v_just_became_error;
end;
$$;

-- service role のみ実行可（create or replace は権限を保持するが、シグネチャ不変を明示するため再宣言する）。
revoke execute on function public.rpc_complete_sink_delivery(uuid, text, int, text, boolean) from public, anon, authenticated;
grant execute on function public.rpc_complete_sink_delivery(uuid, text, int, text, boolean) to service_role;

-- =============================================================================
-- 検証(service role):
--   1) 'defer' を渡すと attempts が増えず(=呼び出し前後で不変)、status='failed'・
--      next_attempt_at ≒ now()+5min・consecutive_failures が +1 されることを確認。
--   2) 同一 sink に 'defer' を20回連続で流すと sink.status='error'・just_became_error=true になり、
--      rpc_reactivate_sink 後に対象 delivery が attempt 無傷(=defer 中は attempts=0 のまま)で再開すること。
--   3) 'sent'/'temporary_fail'/'permanent_fail' の挙動が 20260711121910 と一致すること(回帰なし)。
--   4) M2 precondition の機械検証を満たすこと:
--        select (prosrc like '%defer%') from pg_proc where proname='rpc_complete_sink_delivery';  -- t
-- ロールバック: 20260711121910 の rpc_complete_sink_delivery 定義を create or replace で再適用する。
-- =============================================================================
