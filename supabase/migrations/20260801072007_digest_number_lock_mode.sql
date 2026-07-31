-- =============================================================================
-- 採番RPCのロックを FOR UPDATE → FOR NO KEY UPDATE に弱める
--
-- 20260731231645_digest_number_atomic.sql で入れた2つの採番RPCは、グループ行を
-- `for update`（いちばん強い行ロック）で押さえていた。狙いは「採番同士を直列化する」ことだけ
-- なのに、これは **channel_digest_tasks の INSERT まで待たせる**。
-- 外部キーの参照側 INSERT は親行に `for key share` を取るが、`for update` はこれと衝突するため。
--
-- `for no key update` なら:
--   - `for update` / `for no key update` とは衝突する ＝ **採番同士・タスク作成RPCとの直列化はそのまま**
--   - `for key share` とは衝突しない ＝ タスクのINSERTを巻き込んで待たせない
-- つまり守りたいものは守ったまま、余計な待ちだけが消える。
--
-- ⚠ 関数の置き換え（create or replace）だけ。テーブル・制約・データには一切触れない。
--   適用中に止まる瞬間は無い（同じ引数・同じ戻り値の形のまま中身を差し替える）。
--
-- 中身は 20260731231645 と同一で、ロックの強さだけが違う。採番の決まり方（既存の番号を
-- 動かさない・完了済みの番号を避ける・再採番は期限順）はそちらのコメントを参照。
-- =============================================================================

create or replace function public.rpc_assign_digest_numbers(
  p_group_id uuid,
  p_limit int
)
returns table (
  id uuid,
  title text,
  digest_number int,
  due_date date,
  due_time time,
  assignee_hint text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exists boolean;
  v_max int;
begin
  -- グループ行をロックして直列化する（タスク作成・再採番とも同じ行を取り合う）。
  -- returns table の OUT 名と衝突するため channel_groups は g で必ず修飾する。
  select true into v_exists
  from public.channel_groups g
  where g.id = p_group_id
  for no key update;

  if v_exists is null then
    -- 呼び出し側(findActiveGroup)で存在確認済みの前提。ここで無いのは取得直後の削除等の異常。
    -- 空配列を返すと「タスクが0件」と区別できず、嘘の一覧を返すことになるので例外にする。
    raise exception 'rpc_assign_digest_numbers: unknown group_id %', p_group_id;
  end if;

  -- 使用中の最大番号。完了済みの行も番号を持ち続けるので、open だけ見ると番号を二度配る。
  select coalesce(max(dt.digest_number), 0) into v_max
  from public.channel_digest_tasks dt
  where dt.group_id = p_group_id;

  with target as (
    select
      dt.id as task_id,
      row_number() over (order by dt.created_at asc, dt.id asc) as seq
    from public.channel_digest_tasks dt
    where dt.group_id = p_group_id
      and dt.status = 'open'
      and dt.digest_number is null
  )
  update public.channel_digest_tasks t
     set digest_number = v_max + target.seq
    from target
   where t.id = target.task_id;

  return query
  select dt.id, dt.title, dt.digest_number, dt.due_date, dt.due_time, dt.assignee_hint
  from public.channel_digest_tasks dt
  where dt.group_id = p_group_id
    and dt.status = 'open'
    and dt.digest_number is not null
  order by dt.digest_number asc
  limit p_limit;
end;
$$;

revoke execute on function public.rpc_assign_digest_numbers(uuid, int)
  from public, anon, authenticated;
grant execute on function public.rpc_assign_digest_numbers(uuid, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- (4) 再採番（毎時のまとめ配信の直前に cron から呼ばれる）
--     全部の番号を外してから、期限の早い順で 1..N を振り直す。
--     ⚠ ここだけが番号の総入れ替えをしてよい経路。webhook（人の操作）からは呼ばない。
-- ---------------------------------------------------------------------------
create or replace function public.rpc_clear_and_renumber_digest_tasks(
  p_group_id uuid
)
returns table (
  id uuid,
  title text,
  digest_number int,
  due_date date,
  due_time time,
  assignee_hint text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exists boolean;
begin
  select true into v_exists
  from public.channel_groups g
  where g.id = p_group_id
  for no key update;

  if v_exists is null then
    raise exception 'rpc_clear_and_renumber_digest_tasks: unknown group_id %', p_group_id;
  end if;

  update public.channel_digest_tasks t
     set digest_number = null
   where t.group_id = p_group_id;

  with target as (
    select
      dt.id as task_id,
      row_number() over (
        -- 期限の早い順。時刻の指定が無ければ23:59（その日の最後）とみなす。
        -- 期限なしは最後。同着は登録の古い順（アプリの dueSortKey と同じ並び）。
        order by (dt.due_date + coalesce(dt.due_time, '23:59'::time)) asc nulls last,
                 dt.created_at asc,
                 dt.id asc
      ) as seq
    from public.channel_digest_tasks dt
    where dt.group_id = p_group_id
      and dt.status = 'open'
  )
  update public.channel_digest_tasks t
     set digest_number = target.seq
    from target
   where t.id = target.task_id;

  return query
  select dt.id, dt.title, dt.digest_number, dt.due_date, dt.due_time, dt.assignee_hint
  from public.channel_digest_tasks dt
  where dt.group_id = p_group_id
    and dt.status = 'open'
    and dt.digest_number is not null
  order by dt.digest_number asc;
end;
$$;

revoke execute on function public.rpc_clear_and_renumber_digest_tasks(uuid)
  from public, anon, authenticated;
grant execute on function public.rpc_clear_and_renumber_digest_tasks(uuid)
  to service_role;


-- =============================================================================
-- 検証（scratch）:
--   1) 採番中に同じグループへ別トランザクションから INSERT できる（待たされない）
--   2) 採番同士は従来どおり直列化される（同じ番号が2件に付かない）
--   3) rpc_create_instant_digest_task（for update）とも従来どおり直列化される
--
-- ロールバック: 20260731231645_digest_number_atomic.sql の関数定義部分を再適用する
--   （for update に戻る。正しさは変わらず、余計な待ちが復活するだけ）。
-- =============================================================================
