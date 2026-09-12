-- =============================================================================
-- タスクの担当に置く招待は、そのタスクと同じ space の招待だけ
--
-- 規則:
--   tasks.assignee_invite_id … タスクと同じ組織・同じ space の招待だけを指せる（NULL は確かめない）。
--     作るとき（insert）と、assignee_invite_id・space_id・org_id を書き換えるとき（update）に確かめる。
--     tasks.wiki_page_id（trg_enforce_wiki_page_same_space）・milestone_id と同じ形。
--   招待が承諾されたら rpc_accept_invite が同じトランザクションで担当を本人に移して assignee_invite_id を空にし、
--   招待を消すと外部キーで空に戻る（どちらも空にする書き換えなので、そのまま通る）。招待の space は後から変えない。
--   トリガーは service role からの書き込みにも効く。トリガー関数は SECURITY DEFINER（書いた人の見え方に関係なく
--   招待を読む）・search_path = public。トリガー専用なので、直接は実行させない。
--
-- ロック: 先頭で tasks を share row exclusive で押さえてから変える（トリガーを作るのはこれで足りる。読みは止めない。
--   途中で強いロックに上げない）。待つのは 3 秒まで。取れなければ全体を取り消すので、流し直す。
--   トリガーは drop trigger を使わず、無いときだけ作る（drop trigger if exists は、トリガーが無くても表を
--   access exclusive で押さえるため）。DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。
--   本番の適用は1トランザクションなので、ロックは最後まで持つ）。
-- 前提: 今の行が規則を満たしている（満たさない行が1つでもあれば、末尾の確認で止まる）。
-- 冪等: create or replace function・トリガーは無いときだけ作る。2回流しても同じ。
--   トリガーの定義を変えるときは、別の migration で作り直す（本 migration を流し直しても、すでにあるトリガーは変えない）。
-- 可逆: 節 1 の末尾のロールバック節。行の中身は変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: ロックと、土台の確認（何も変えない）
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.tasks in share row exclusive mode;
end $$;

-- 土台: tasks.assignee_invite_id が invites(id) を指す外部キー（20260910201312_task_assignee_invite.sql）。無ければ止める
do $$
begin
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.tasks'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.invites'::regclass
       and c.conkey = array[(select a.attnum from pg_attribute a
                              where a.attrelid = 'public.tasks'::regclass and a.attname = 'assignee_invite_id')]
  ) then
    raise exception 'task assignee invite same space: 先に 20260910201312_task_assignee_invite.sql を当てる';
  end if;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる。確認は何も変えない）
-- =============================================================================
-- 節 1: タスクの担当の招待は、同じ組織・同じ space のものだけ
-- =============================================================================

create or replace function public.enforce_assignee_invite_same_space()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.assignee_invite_id is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.invites i
     where i.id = new.assignee_invite_id
       and i.org_id = new.org_id
       and i.space_id = new.space_id
  ) then
    raise exception '% assignee invite must be in the same space', tg_table_name;
  end if;

  return new;
end;
$$;

comment on function public.enforce_assignee_invite_same_space() is
  'tasks の assignee_invite_id は、同じ組織・同じ space の招待だけ';

-- トリガー専用。直接は実行させない（トリガーとしての実行には実行権は要らない）
revoke all on function public.enforce_assignee_invite_same_space() from public, anon, authenticated, service_role;

-- 無いときだけ作る（drop trigger は使わない。トリガーが無くても表を access exclusive で押さえるため）
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.tasks'::regclass
       and tgname = 'trg_enforce_assignee_invite_same_space'
       and not tgisinternal
  ) then
    create trigger trg_enforce_assignee_invite_same_space
      before insert or update of assignee_invite_id, space_id, org_id on public.tasks
      for each row
      execute function public.enforce_assignee_invite_same_space();
  end if;
end $$;

-- ロールバック（節 1）:
--   drop trigger if exists trg_enforce_assignee_invite_same_space on public.tasks;
--   drop function if exists public.enforce_assignee_invite_same_space();
-- =============================================================================
-- 節 2: 末尾の確認（何も変えない）… トリガーが有効・トリガー関数が本 migration の本文で SECURITY DEFINER・
--   search_path = public・直接は実行できない・今の行が規則を満たしている。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
  v_n    bigint;
begin
  -- トリガー: 有効（O）。決めた列の insert / update の前に、行ごとに動く
  select format('%s:%s', t.tgenabled::text,
                (pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF assignee_invite_id, space_id, org_id ON public.tasks'
                                               ' FOR EACH ROW EXECUTE FUNCTION %enforce_assignee_invite_same_space()')::text)
    into v_text
    from pg_trigger t
   where t.tgrelid = 'public.tasks'::regclass
     and t.tgname = 'trg_enforce_assignee_invite_same_space'
     and not t.tgisinternal;
  if v_text is distinct from 'O:true' then
    v_bad := v_bad || ' トリガー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- トリガー関数: 本 migration の本文・SECURITY DEFINER・search_path = public・誰も直接は実行できない
  --   （実行権は public / anon / authenticated / service_role の順）
  select format('%s:%s:%s:%s/%s/%s/%s', md5(p.prosrc), p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    into v_text
    from pg_proc p
   where p.oid = to_regprocedure('public.enforce_assignee_invite_same_space()');
  if v_text is distinct from '42ff0f2f8dd350ffeac7510eca91cd85:true:search_path=public:false/false/false/false' then
    v_bad := v_bad || ' トリガー関数: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 今の行: 担当の招待が別の組織・別の space を指すタスクが 0
  select count(*) into v_n
    from public.tasks t
    join public.invites i on i.id = t.assignee_invite_id
   where i.space_id <> t.space_id or i.org_id <> t.org_id;
  if v_n > 0 then
    v_bad := v_bad || format(' 規則に合わないタスクの assignee_invite_id=%s;', v_n);
  end if;

  if v_bad <> '' then
    raise exception 'task assignee invite same space: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 2）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_task_assignee_invite_same_space.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番・読むだけ）: 次が 0 件（0 件でなければ節 2 で止まる）:
--        select count(*) from public.tasks t join public.invites i on i.id = t.assignee_invite_id
--         where i.space_id <> t.space_id or i.org_id <> t.org_id;
--   2) 適用後（本番）: 節 2 が通る。
--   3) 画面・処理: タスクの担当に同じプロジェクトの招待中の人を置ける／招待を受けると担当が本人に移る。
-- =============================================================================
