-- =============================================================================
-- space と組織の境目を DB でも守る（CLI / MCP の道具の側の照合と二重にする）
--
-- 規則:
--   tasks.wiki_page_id … タスクと同じ組織・同じ space の Wiki ページだけを指せる（NULL は確かめない）。
--     作るとき（insert）と、wiki_page_id・space_id・org_id を書き換えるとき（update）に確かめる。
--     tasks / meetings の milestone_id（trg_enforce_milestone_same_space）と同じ形。
--   invites … (space_id, org_id) は spaces (id, org_id) と一致する（組み合わせの外部キー。
--     ON DELETE は space_id の外部キーと同じ CASCADE。ほかの space 単位の表と同じ形）。
--   space_memberships … 入る人は、その space の組織のメンバー（org_memberships に行がある人）だけ。
--     作るとき（insert）と、space_id か user_id を書き換えるとき（update）に確かめる。役割だけの変更は確かめない。
--     招待の受諾（rpc_accept_invite）は組織のメンバーを先に入れてから space に入れるので、そのまま通る。
--   mcp_authorize … 個人鍵（scope = 'user'）でも、指す space が鍵の組織のものであること（space 鍵・組織鍵と同じ確かめ方）。
--     ほかの判定・引数・戻り値の形・実行権（service_role だけ）は変えない。
--   トリガーは service role からの書き込みにも効く。トリガー関数は SECURITY DEFINER（書いた人の見え方に関係なく、
--     ページ・space・組織のメンバーを読む）・search_path = public。トリガー専用なので、直接は実行させない。
--
-- ロック: 先頭で tasks・invites・space_memberships・spaces をまとめて share row exclusive で押さえてから変える
--   （トリガーを作るのも外部キーを足すのも share row exclusive で足りる。読みは止めない。途中で強いロックに上げない。
--   spaces は invites の外部キーを足すときに参照される）。待つのは 3 秒まで。取れなければ全体を取り消すので、流し直す。
--   トリガーは drop trigger を使わず、無いときだけ作る（drop trigger if exists は、トリガーが無くても表を
--   access exclusive で押さえるため）。DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。
--   本番の適用は1トランザクションなので、ロックは最後まで持つ）。
-- 前提: 今の行が規則を満たしている（満たさない行が1つでもあれば、外部キーの確かめか末尾の確認で止まる）。
-- 冪等: create or replace function・トリガーと外部キーは無いときだけ作る。2回流しても同じ。
--   トリガーの定義を変えるときは、別の migration で作り直す（本 migration を流し直しても、すでにあるトリガーは変えない）。
-- 可逆: 節 1〜4 の末尾のロールバック節（後ろの節から順に流す）。行の中身は変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: ロックと、mcp_authorize の土台の確認（何も変えない）
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.tasks, public.invites, public.space_memberships, public.spaces in share row exclusive mode;
end $$;

-- mcp_authorize の今の定義が、土台（20260910221705_mcp_authorize_internal_only.sql）か本 migration の定義と
--   1文字でも違えば止める（本番だけにある手直しを上書きしないため。止まったら pg_get_functiondef と土台のファイルを見比べる）
do $$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.mcp_authorize(uuid,uuid,uuid,text,text,uuid)')
     and p.prosecdef
     and p.proconfig = array['search_path=public'];

  if v_md5 is null or v_md5 not in ('02ad61827323094d3240b7f815676e2b', '78b4d4465b0c123e17a433e420f53fea') then
    raise exception 'space scope invariants: mcp_authorize の今の定義が、土台にした migration の定義と違います（md5=%）',
      coalesce(v_md5, '(なし)');
  end if;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる。確認は何も変えない）
-- =============================================================================
-- 節 1: タスクの Wiki ページは、同じ組織・同じ space のものだけ
-- =============================================================================

create or replace function public.enforce_wiki_page_same_space()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.wiki_page_id is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.wiki_pages w
     where w.id = new.wiki_page_id
       and w.org_id = new.org_id
       and w.space_id = new.space_id
  ) then
    raise exception '% wiki page must be in the same space', tg_table_name;
  end if;

  return new;
end;
$$;

comment on function public.enforce_wiki_page_same_space() is
  'tasks の wiki_page_id は、同じ組織・同じ space の Wiki ページだけ';

-- トリガー専用。直接は実行させない（トリガーとしての実行には実行権は要らない）
revoke all on function public.enforce_wiki_page_same_space() from public, anon, authenticated, service_role;

-- 無いときだけ作る（drop trigger は使わない。トリガーが無くても表を access exclusive で押さえるため）
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.tasks'::regclass
       and tgname = 'trg_enforce_wiki_page_same_space'
       and not tgisinternal
  ) then
    create trigger trg_enforce_wiki_page_same_space
      before insert or update of wiki_page_id, space_id, org_id on public.tasks
      for each row
      execute function public.enforce_wiki_page_same_space();
  end if;
end $$;

-- ロールバック（節 1）:
--   drop trigger if exists trg_enforce_wiki_page_same_space on public.tasks;
--   drop function if exists public.enforce_wiki_page_same_space();
-- =============================================================================
-- 節 2: 招待の space と組織の組み合わせ（(space_id, org_id) → spaces (id, org_id)）
-- =============================================================================

-- 無いときだけ足す（NOT VALID: 足す時点では今の行を読まない）→ 今の行を確かめる
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.invites'::regclass
       and conname = 'invites_space_org_fkey'
  ) then
    alter table public.invites
      add constraint invites_space_org_fkey
      foreign key (space_id, org_id) references public.spaces (id, org_id) on delete cascade not valid;
  end if;
end $$;

alter table public.invites validate constraint invites_space_org_fkey;

-- ロールバック（節 2）:
--   alter table public.invites drop constraint if exists invites_space_org_fkey;
-- =============================================================================
-- 節 3: space のメンバーは、その space の組織のメンバーだけ
-- =============================================================================

create or replace function public.enforce_space_member_in_org()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not exists (
    select 1
      from public.spaces s
      join public.org_memberships om
        on om.org_id = s.org_id
       and om.user_id = new.user_id
     where s.id = new.space_id
  ) then
    raise exception 'space member must be a member of the space organization';
  end if;

  return new;
end;
$$;

comment on function public.enforce_space_member_in_org() is
  'space_memberships に入る人は、その space の組織のメンバー（org_memberships に行がある人）だけ';

-- トリガー専用。直接は実行させない
revoke all on function public.enforce_space_member_in_org() from public, anon, authenticated, service_role;

-- 無いときだけ作る（drop trigger は使わない。トリガーが無くても表を access exclusive で押さえるため）
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.space_memberships'::regclass
       and tgname = 'trg_enforce_space_member_in_org'
       and not tgisinternal
  ) then
    create trigger trg_enforce_space_member_in_org
      before insert or update of space_id, user_id on public.space_memberships
      for each row
      execute function public.enforce_space_member_in_org();
  end if;
end $$;

-- ロールバック（節 3）:
--   drop trigger if exists trg_enforce_space_member_in_org on public.space_memberships;
--   drop function if exists public.enforce_space_member_in_org();
-- =============================================================================
-- 節 4: mcp_authorize … 個人鍵でも、指す space が鍵の組織のものであること
--   土台: 20260910221705_mcp_authorize_internal_only.sql（節 0 で md5 を確かめ済み）。
--   本文は土台をそのまま写し、scope = 'user' の分岐の最後に、space 鍵・組織鍵と同じ確認を1つ足しただけ。
--   create or replace なので、実行権（service_role だけ）はそのまま。
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mcp_authorize(p_key_id uuid, p_user_id uuid, p_space_id uuid, p_action text, p_resource_type text DEFAULT NULL::text, p_resource_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key_record RECORD;
  v_member_record RECORD;
  v_result jsonb;
  v_allowed boolean := false;
  v_role text;
  v_reason text;
BEGIN
  -- 1) APIキーの検証
  SELECT * INTO v_key_record
  FROM api_keys
  WHERE id = p_key_id
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Invalid or expired API key'
    );
  END IF;

  -- 1b) 鍵の持ち主の確認: 鍵は発行した本人の代わりにだけ動き、持ち主はその組織のメンバーであること
  IF v_key_record.user_id IS NULL OR v_key_record.user_id IS DISTINCT FROM v_key_record.created_by THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'API key owner mismatch'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_memberships om
    WHERE om.org_id = v_key_record.org_id
      AND om.user_id = v_key_record.user_id
  ) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Key owner is not a member of the organization'
    );
  END IF;

  -- 2) アクションの許可チェック
  IF NOT (p_action = ANY(v_key_record.allowed_actions)) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', format('Action "%s" not allowed for this API key', p_action)
    );
  END IF;

  -- 3) スコープに基づくスペースアクセスチェック
  CASE v_key_record.scope
    WHEN 'space' THEN
      -- space_id が一致する必要がある
      IF v_key_record.space_id IS DISTINCT FROM p_space_id THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'Space ID does not match API key scope'
        );
      END IF;

      -- そのプロジェクトが鍵の組織のものである必要がある
      IF NOT EXISTS (
        SELECT 1 FROM spaces s
        WHERE s.id = p_space_id AND s.org_id = v_key_record.org_id
      ) THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'Space does not belong to the organization'
        );
      END IF;

    WHEN 'org' THEN
      -- スペースが同じ組織に属している必要がある
      IF NOT EXISTS (
        SELECT 1 FROM spaces s
        WHERE s.id = p_space_id AND s.org_id = v_key_record.org_id
      ) THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'Space does not belong to the organization'
        );
      END IF;

    WHEN 'user' THEN
      -- ユーザーがスペースのメンバーである必要がある
      IF v_key_record.user_id IS NULL THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'User-scoped key requires user_id'
        );
      END IF;

      -- allowed_space_ids が設定されている場合はチェック
      IF v_key_record.allowed_space_ids IS NOT NULL
         AND NOT (p_space_id = ANY(v_key_record.allowed_space_ids)) THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'Space not in allowed_space_ids'
        );
      END IF;

      -- 個人鍵でも、そのプロジェクトが鍵の組織のものである必要がある
      IF NOT EXISTS (
        SELECT 1 FROM spaces s
        WHERE s.id = p_space_id AND s.org_id = v_key_record.org_id
      ) THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'Space does not belong to the organization'
        );
      END IF;
  END CASE;

  -- 4) ユーザーのスペースメンバーシップと権限チェック
  SELECT sm.role INTO v_role
  FROM space_memberships sm
  WHERE sm.space_id = p_space_id
    AND sm.user_id = COALESCE(v_key_record.user_id, p_user_id);

  IF v_role IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'User is not a member of this space'
    );
  END IF;

  -- 5) ロールに基づくアクション許可チェック
  CASE v_role
    WHEN 'viewer' THEN
      -- viewer は read のみ
      v_allowed := (p_action = 'read');
      IF NOT v_allowed THEN
        v_reason := 'Viewer role can only read';
      END IF;

    WHEN 'client', 'vendor' THEN
      -- 相手先（client / vendor）の役割では API キーを使えない（API キーは社内メンバー専用）
      v_allowed := false;
      v_reason := 'API keys are available to internal members only';
    WHEN 'editor' THEN
      -- editor は read, write, delete（自分のリソースのみ）
      IF p_action IN ('read', 'write') THEN
        v_allowed := true;
      ELSIF p_action = 'delete' THEN
        -- 自分が作成したリソースのみ削除可能
        IF p_resource_type = 'task' AND p_resource_id IS NOT NULL THEN
          v_allowed := EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.id = p_resource_id
              AND t.created_by = COALESCE(v_key_record.user_id, p_user_id)
          );
          IF NOT v_allowed THEN
            v_reason := 'Editor can only delete own tasks';
          END IF;
        ELSE
          v_allowed := false;
          v_reason := 'Delete requires resource ownership';
        END IF;
      ELSE
        v_allowed := false;
        v_reason := 'Editor cannot perform bulk operations';
      END IF;

    WHEN 'admin' THEN
      -- admin は全ての操作が可能
      v_allowed := true;

    ELSE
      v_allowed := false;
      v_reason := 'Unknown role';
  END CASE;

  -- 結果を返す
  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'role', v_role,
    'scope', v_key_record.scope,
    'reason', COALESCE(v_reason, 'OK')
  );
END;
$function$;

-- ロールバック（節 4。足した確認を外して作り直す＝土台の本文に戻る）:
--   do $$
--   begin
--     execute regexp_replace(
--       pg_get_functiondef('public.mcp_authorize(uuid,uuid,uuid,text,text,uuid)'::regprocedure),
--       E'\n\n      -- 個人鍵でも、そのプロジェクトが鍵の組織のものである必要がある\n.*?\n      END IF;', '');
--   end $$;
-- =============================================================================
-- 節 5: 末尾の確認（何も変えない）… トリガーが有効・トリガー関数が SECURITY DEFINER・search_path = public で
--   直接は実行できない・招待の外部キーが確かめ済み・mcp_authorize が本 migration の本文で実行権は service_role だけ・
--   今の行が規則を満たしている。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
  v_n    bigint;
begin
  -- トリガー: 有効（O）。決めた列の insert / update の前に、行ごとに動く
  select string_agg(format('%s:%s:%s', t.tgname, t.tgenabled::text, (pg_get_triggerdef(t.oid) like e.def_like)::text),
                    ',' order by t.tgname collate "C")
    into v_text
    from (values
      ('public.tasks'::regclass, 'trg_enforce_wiki_page_same_space',
       '%BEFORE INSERT OR UPDATE OF wiki_page_id, space_id, org_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION %enforce_wiki_page_same_space()'),
      ('public.space_memberships'::regclass, 'trg_enforce_space_member_in_org',
       '%BEFORE INSERT OR UPDATE OF space_id, user_id ON public.space_memberships FOR EACH ROW EXECUTE FUNCTION %enforce_space_member_in_org()')
    ) as e(rel, name, def_like)
    join pg_trigger t on t.tgrelid = e.rel and t.tgname = e.name and not t.tgisinternal;
  if v_text is distinct from 'trg_enforce_space_member_in_org:O:true,trg_enforce_wiki_page_same_space:O:true' then
    v_bad := v_bad || ' トリガー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- トリガー関数: SECURITY DEFINER・search_path = public・PUBLIC / anon / authenticated / service_role は実行できない
  select string_agg(p.proname, ',' order by p.proname collate "C")
    into v_text
    from pg_proc p
   where p.oid in (to_regprocedure('public.enforce_wiki_page_same_space()'),
                   to_regprocedure('public.enforce_space_member_in_org()'))
     and p.prosecdef
     and p.proconfig = array['search_path=public']
     and not has_function_privilege('public', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute');
  if v_text is distinct from 'enforce_space_member_in_org,enforce_wiki_page_same_space' then
    v_bad := v_bad || ' トリガー関数: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 招待の外部キー: 確かめ済み・ON DELETE CASCADE
  select format('%s:%s', c.convalidated::text, c.confdeltype::text)
    into v_text
    from pg_constraint c
   where c.conrelid = 'public.invites'::regclass
     and c.conname = 'invites_space_org_fkey'
     and c.contype = 'f';
  if v_text is distinct from 'true:c' then
    v_bad := v_bad || ' 招待の外部キー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- mcp_authorize: 本 migration の本文・SECURITY DEFINER・search_path = public・実行できるのは service_role だけ
  select format('%s:%s:%s:%s/%s/%s/%s', md5(p.prosrc), p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    into v_text
    from pg_proc p
   where p.oid = to_regprocedure('public.mcp_authorize(uuid,uuid,uuid,text,text,uuid)');
  if v_text is distinct from '78b4d4465b0c123e17a433e420f53fea:true:search_path=public:false/false/false/true' then
    v_bad := v_bad || ' mcp_authorize: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 今の行: 規則に合わないタスクの wiki_page_id・規則に合わない space のメンバーが 0
  select count(*) into v_n
    from public.tasks t
    join public.wiki_pages w on w.id = t.wiki_page_id
   where w.space_id <> t.space_id or w.org_id <> t.org_id;
  if v_n > 0 then
    v_bad := v_bad || format(' 規則に合わないタスクの wiki_page_id=%s;', v_n);
  end if;

  select count(*) into v_n
    from public.space_memberships sm
    join public.spaces s on s.id = sm.space_id
   where not exists (select 1 from public.org_memberships om where om.org_id = s.org_id and om.user_id = sm.user_id);
  if v_n > 0 then
    v_bad := v_bad || format(' 規則に合わない space のメンバー=%s;', v_n);
  end if;

  if v_bad <> '' then
    raise exception 'space scope invariants: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 5）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_space_scope_invariants.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番・読むだけ）: 次の3つが 0 件（0 件でなければ、外部キーの確かめか節 5 で止まる）:
--        select count(*) from public.tasks t join public.wiki_pages w on w.id = t.wiki_page_id
--         where w.space_id <> t.space_id or w.org_id <> t.org_id;
--        select count(*) from public.invites i join public.spaces s on s.id = i.space_id where s.org_id <> i.org_id;
--        select count(*) from public.space_memberships sm join public.spaces s on s.id = sm.space_id
--         where not exists (select 1 from public.org_memberships om where om.org_id = s.org_id and om.user_id = sm.user_id);
--      mcp_authorize の今の本文が土台と同じ:
--        select md5(prosrc) from pg_proc where oid = 'public.mcp_authorize(uuid,uuid,uuid,text,text,uuid)'::regprocedure;
--          → 02ad61827323094d3240b7f815676e2b
--   2) 適用後（本番）: 節 5 が通る。
--   3) 画面・処理: タスクに同じプロジェクトの Wiki ページを紐づけられる／招待を受けてプロジェクトに入れる（社内・相手先・協力会社）／
--      CLI・MCP の個人鍵で、鍵の組織のプロジェクトを今までどおり操作できる。
-- =============================================================================
