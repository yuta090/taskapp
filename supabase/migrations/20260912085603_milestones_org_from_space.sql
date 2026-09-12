-- =============================================================================
-- マイルストーンの組織は、その space の組織から決める
--
-- 規則:
--   milestones.org_id は、行の space（space_id）の組織を写す。書き手が渡した値は使わない
--     （渡さなくても・違う値を渡しても、space の組織になる）。
--   作るとき（insert）と、space_id か org_id を書き換えるとき（update）に、行を書き込む前に決める。
--     RLS の with check（app_can_write_space(space_id, org_id)）は、決めた後の値で判定する。
--   関数は SECURITY DEFINER: 書いた人に見えるかどうかに関わらず、space の実際の組織を読む。
--     トリガー専用なので、直接は実行させない。
--   space が無ければ組織は空のままで、書き込みは通らない。
--   既にある行は変えない（(space_id, org_id) → spaces(id, org_id) の外部キーで、すでに space の組織と同じ）。
--
-- ロック: 先頭で milestones を access exclusive で押さえてから、トリガーを付け替える（途中で強いロックに上げない）。
--   待つのは 3 秒まで。取れなければ全体を取り消すので、流し直す。
--   DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。本番の適用は1トランザクションなので、
--   ロックは最後まで持つ）。
-- 冪等: create or replace function・drop trigger if exists → create。2回流しても同じ。
-- 可逆: 節 2 の末尾のロールバック節。行の中身は変えない。
-- =============================================================================


-- =============================================================================
-- 節 1: ロック
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.milestones in access exclusive mode;
end $$;

-- ロールバック（節 1）: なし（ロックはトランザクションの終わりで外れる）
-- =============================================================================
-- 節 2: 組織を space から写すトリガー
-- =============================================================================

create or replace function public.milestones_fill_org()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  new.org_id := (select s.org_id from public.spaces s where s.id = new.space_id);
  return new;
end;
$$;

comment on function public.milestones_fill_org() is
  'milestones のトリガー: 組織を space から写す（書き手の値は使わない）';

-- トリガー専用。直接は実行させない（トリガーとしての実行には実行権は要らない）
revoke all on function public.milestones_fill_org() from public, anon, authenticated, service_role;

drop trigger if exists trg_milestones_fill_org on public.milestones;
create trigger trg_milestones_fill_org
  before insert or update of space_id, org_id on public.milestones
  for each row execute function public.milestones_fill_org();

-- ロールバック（節 2。トリガーと関数を外す。行の中身は変えない）:
--   drop trigger if exists trg_milestones_fill_org on public.milestones;
--   drop function if exists public.milestones_fill_org();
-- =============================================================================
-- 節 3: 末尾の確認（何も変えない）… トリガーが有効で、関数が SECURITY DEFINER・search_path = public・
--   直接は実行できない。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
begin
  -- トリガー: 有効（O）。insert と、space_id / org_id の update の前に、行ごとに milestones_fill_org() を呼ぶ
  select format('%s:%s:%s', t.tgenabled::text,
                (t.tgfoid = to_regprocedure('public.milestones_fill_org()'))::text,
                (pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF space_id, org_id ON public.milestones FOR EACH ROW%')::text)
    into v_text
    from pg_trigger t
   where t.tgrelid = 'public.milestones'::regclass
     and t.tgname = 'trg_milestones_fill_org'
     and not t.tgisinternal;
  if v_text is distinct from 'O:true:true' then
    v_bad := v_bad || ' トリガー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 関数: SECURITY DEFINER・search_path = public
  select format('definer=%s config=%s', p.prosecdef::text, coalesce(array_to_string(p.proconfig, ';'), ''))
    into v_text
    from pg_proc p
   where p.oid = to_regprocedure('public.milestones_fill_org()');
  if v_text is distinct from 'definer=true config=search_path=public' then
    v_bad := v_bad || ' 関数: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 直接は実行できない（PUBLIC・anon・authenticated・service_role に実行権が無い）
  select string_agg(r, ',') into v_text
    from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r
   where has_function_privilege(r, 'public.milestones_fill_org()', 'execute');
  if v_text is not null then
    v_bad := v_bad || ' 実行できる役割: ' || v_text || ';';
  end if;

  if v_bad <> '' then
    raise exception 'milestones org from space: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 3）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_milestones_org_from_space.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用後（本番）: 節 3 が通る。画面（プロジェクト設定のマイルストーン・タスク作成の中のマイルストーン追加）で
--      組織を渡さずに作れて、組織がその space の組織になっている:
--        select m.id, m.org_id = s.org_id as same_org
--          from public.milestones m join public.spaces s on s.id = m.space_id
--         order by m.created_at desc limit 5;
-- =============================================================================
