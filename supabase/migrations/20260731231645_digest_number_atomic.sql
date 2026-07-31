-- =============================================================================
-- 一覧番号（digest_number）の採番を DB 側で直列化する
--
-- 何が起きていたか:
--   採番は「いまの最大番号を読む → +1 して書く」をアプリ側でやっていた。読みと書きの間に
--   ロックが無いので、同じグループでほぼ同時に2件「タスク追加」されると、両方が同じ最大値を
--   読んで **同じ番号を2件に配る**。
--   その状態で「完了 6」と送ると、markDigestTaskDoneByGroupAndNumberAtomic の UPDATE が
--   2行に当たり、**2件とも完了になったうえで maybeSingle が複数行で失敗し null を返す**
--   ＝利用者には「そのタスクは既に完了済みです」と表示される。本人は何も終わっていないと
--   思っているのに2件消える。
--
--   書き手が cron の再採番だけだった頃は直列だったので起きなかった。「タスク追加」「一覧」を
--   足して**人が採番のきっかけを作れるようになった**ことで、初めて到達可能になった。
--
-- 対策（2段構え）:
--   1. 採番を RPC に移し、**channel_groups の行を FOR UPDATE でロック**してから読み書きする。
--      ロック対象を rpc_create_instant_digest_task / rpc_ingest_digest_tasks と同じ行に
--      そろえているので、「タスク作成」と「採番」も互いに直列化される。
--   2. 万一 1 をすり抜けても壊れないよう、**open な行の (group_id, digest_number) に一意制約**を張る。
--      壊れたデータを作るくらいなら、その場でエラーにして落とす（誤配信より欠配信）。
--
-- 並び順・番号の決まり方はアプリ側の実装と1:1で合わせてある（挙動は変えない）:
--   - 追加採番: 既存の番号は1つも動かさず、「使用中の最大＋1」から created_at 順に続きを振る。
--     完了済みの行が持っている番号も最大値に数える（同じ番号を二度配らない）。
--   - 再採番(cron): 全部の番号を外してから、期限の早い順（期限なしは最後）→ created_at 順で 1..N。
--     期限は「日付＋時刻(未指定は23:59)」で比較する（アプリの dueSortKey と同じ）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (1) 既にできてしまっている重複を直す
--     open な行で番号がぶつかっているものは、いちばん古い1行だけ番号を残し、
--     残りは番号を外す（次の採番で続きの番号が付く）。タスク自体は消さない。
-- ---------------------------------------------------------------------------
with dup as (
  select
    id,
    row_number() over (
      partition by group_id, digest_number
      order by created_at asc, id asc
    ) as rn
  from public.channel_digest_tasks
  where status = 'open' and digest_number is not null
)
update public.channel_digest_tasks t
   set digest_number = null
  from dup
 where t.id = dup.id
   and dup.rn > 1;

-- ---------------------------------------------------------------------------
-- (2) 一意制約（すり抜けの最後の砦）
--     既存の同名インデックス(channel_digest_tasks_group_open_number)は「完了N」の突合用に
--     そのまま残す。こちらは制約が目的で、番号未設定(null)の行は対象外。
-- ---------------------------------------------------------------------------
create unique index if not exists channel_digest_tasks_group_open_number_unique
  on public.channel_digest_tasks (group_id, digest_number)
  where status = 'open' and digest_number is not null;

-- ---------------------------------------------------------------------------
-- (3) 追加採番（「タスク追加」「一覧」から呼ばれる）
--     番号がまだ無い open 行にだけ続きの番号を振り、いま一覧に出る行を番号順で返す。
--     ⚠ 既存の番号は1行も更新しない。動かすと、利用者の手元に残っている前のお知らせの
--       番号が別のタスクを指し、「完了3」で身に覚えのないタスクが消える。
-- ---------------------------------------------------------------------------
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
  for update;

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
  for update;

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
--   1) 同時に2件「タスク追加」→ 番号が重複しない（ロックで直列化される）
--   2) 追加採番で既存の番号が1つも変わらない
--   3) 完了済みの行が持つ番号を再利用しない
--   4) 再採番は期限の早い順・期限なしは最後・同着は登録順で 1..N
--   5) 一意制約: open で同じ番号を無理やり入れようとすると失敗する
--
-- ⚠ リリース順序: **このマイグレーションを先に適用してから**、RPC を呼ぶコードをデプロイする。
--    逆順にすると「関数が無い」で「タスク追加」「一覧」「毎時のまとめ」が動かない。
--
-- ロールバック:
--   drop function if exists public.rpc_assign_digest_numbers(uuid, int);
--   drop function if exists public.rpc_clear_and_renumber_digest_tasks(uuid);
--   drop index if exists public.channel_digest_tasks_group_open_number_unique;
--   （アプリを先に戻すこと。関数を消してからコードを戻すと、その間だけ動かない）
-- =============================================================================
