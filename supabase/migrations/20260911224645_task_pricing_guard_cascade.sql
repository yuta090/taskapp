-- =============================================================================
-- 見積の行を消すときの見張り（guard_task_pricing_delete）は、タスク・space を消したときの連鎖削除を通す
--
-- 規則: 見積の行（task_pricing）を消せるのは、service role と、その space の admin / editor だけ。
--   タスク・space を消したときの連鎖削除（トリガーの中の削除）に限って通す。
--   書き込み（insert / update）の見張り（guard_task_pricing_write）は変えない（連鎖削除では動かない）。
--
-- 本文: 土台は 20260308_003_task_pricing_write_guard.sql の定義（本番と同じ本文）。
--   service_role の確認の直後に、連鎖削除を通す確認を足しただけ。
--   SECURITY DEFINER と search_path = public（20260911194852_definer_search_path.sql）は保つ。
--   実行権・持ち主・トリガーは変えない（create or replace は既にある実行権を保つ）。
--   space を消したときに見積の行も消えるのは、*_task_pricing_space_cascade.sql（space の外部キーを CASCADE）の後。
--
-- 冪等: 今の定義が土台か本 migration の定義のときだけ作り直す。2回流しても同じ。
-- 可逆: 節 1 の末尾のロールバック節（足した確認を外して、土台の本文に戻す）。データは変えない。
-- =============================================================================


-- =============================================================================
-- 節 1: guard_task_pricing_delete を、土台の本文に連鎖削除を通す確認を足して作り直す
-- =============================================================================

-- 確認: 今の定義が土台（または本 migration の定義）と1文字でも違えば止める
--   （本番だけにある手直しを上書きしないため。止まったら pg_get_functiondef と土台のファイルを見比べる）
do $$
declare
  v_bad text;
begin
  select string_agg(e.fn, ', ' order by e.fn)
    into v_bad
    from (values
      ('guard_task_pricing_delete()', 'e3de091831b5e37a2b926eb6e5fee99c', 'a2333a2e20340170911f6b38dff3a2d8')
    ) as e(fn, base_md5, new_md5)
    left join pg_proc p on p.oid = to_regprocedure('public.' || e.fn)
   where p.oid is null
      or md5(p.prosrc) not in (e.base_md5, e.new_md5)
      or not p.prosecdef
      or p.proconfig is distinct from array['search_path=public'];

  if v_bad is not null then
    raise exception 'task pricing guard: 次の関数の今の定義が、土台にした定義と違います: %', v_bad;
  end if;
end $$;

create or replace function public.guard_task_pricing_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  caller_role text;
begin
  if current_setting('role', true) = 'service_role' then
    return old;
  end if;

  -- タスク・space を消したときの連鎖削除（トリガーの中の削除）に限って通す
  if pg_trigger_depth() > 1
     and (not exists (select 1 from tasks t where t.id = old.task_id)
          or not exists (select 1 from spaces s where s.id = old.space_id)) then
    return old;
  end if;

  select t.space_id into v_space_id
    from tasks t
   where t.id = old.task_id;

  select sm.role into caller_role
    from space_memberships sm
   where sm.space_id = v_space_id
     and sm.user_id = auth.uid()
   limit 1;

  if caller_role in ('admin', 'editor') then
    return old;
  end if;

  raise exception 'permission denied: only admin/editor can delete task pricing';
end;
$$;

-- 確認: 本文が本 migration の定義で、SECURITY DEFINER・search_path = public のまま。
--   トリガー（trg_guard_task_pricing_delete）もこの関数を呼び、有効のまま（違えば止める）
do $$
declare
  v_fn constant regprocedure := 'public.guard_task_pricing_delete()'::regprocedure;
begin
  if not exists (
       select 1 from pg_proc p
        where p.oid = v_fn
          and md5(p.prosrc) = 'a2333a2e20340170911f6b38dff3a2d8'
          and p.prosecdef
          and p.proconfig is not distinct from array['search_path=public'])
     or not exists (
       select 1 from pg_trigger t
        where t.tgrelid = 'public.task_pricing'::regclass
          and t.tgname = 'trg_guard_task_pricing_delete'
          and t.tgfoid = v_fn
          and t.tgenabled = 'O') then
    raise exception 'task pricing guard: guard_task_pricing_delete の定義か、それを呼ぶトリガーが想定と違います';
  end if;
end $$;

-- ロールバック（節 1。足した確認を外して、土台の本文に戻す。SECURITY DEFINER・search_path・実行権は変わらない）:
--   do $$
--   begin
--     execute replace(
--       pg_get_functiondef('public.guard_task_pricing_delete()'::regprocedure),
--       E'  -- タスク・space を消したときの連鎖削除（トリガーの中の削除）に限って通す\n  if pg_trigger_depth() > 1\n     and (not exists (select 1 from tasks t where t.id = old.task_id)\n          or not exists (select 1 from spaces s where s.id = old.space_id)) then\n    return old;\n  end if;\n\n',
--       '');
--     if (select md5(p.prosrc) from pg_proc p where p.oid = 'public.guard_task_pricing_delete()'::regprocedure)
--        is distinct from 'e3de091831b5e37a2b926eb6e5fee99c' then
--       raise exception 'task pricing guard rollback: 土台の本文（md5 e3de091831b5e37a2b926eb6e5fee99c）に戻りませんでした';
--     end if;
--   end $$;
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_task_pricing_guard.sh（全 PASS）。RED=1 を付けると本 migration 抜きで流し、
--      変わるはずの assert（chg_*）が全て落ちることを確かめられる。
--   1) 適用前（本番）: 土台と同じかを確かめる:
--        select md5(prosrc), proconfig from pg_proc where oid = 'public.guard_task_pricing_delete()'::regprocedure;
--          → e3de091831b5e37a2b926eb6e5fee99c / {search_path=public}
--   2) 適用後（本番）: 同じ問い合わせで md5 が本 migration の定義（節 1 の確認の値）になり、proconfig はそのまま。
--   3) 画面: 見積の行があるタスクを editor が消せる。閲覧者・相手先は見積を消せない。
-- =============================================================================
