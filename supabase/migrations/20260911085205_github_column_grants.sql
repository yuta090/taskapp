-- =============================================================================
-- GitHub の PR・Issue の列を絞り、接続状態を返す RPC を足す（本対応① PR-B の DB 部分）
-- 確定設計: Fable 裁定 2026-09-11
-- 依存: 20240205_000_github_integration.sql, 20260703_001_rls_helpers.sql（app_is_org_internal）,
--       20260911002110_github_issues_link.sql, 20260911080909_github_visibility_connector_only.sql を先に適用。
--
-- 目的: リポジトリ名・GitHub のアカウント名・PR/Issue の作者名・担当者名は、GitHub を接続した本人
--   （github_installations.created_by）以外に見せない。PR・Issue のタイトルと状態は、
--   そのプロジェクトのメンバーに見えてよい。（リポジトリ名から顧客名が類推できるため）
--   見える行は 20260911080909（応急処置）のまま。本 migration は見える列を絞る。
--
-- 確定した可視性（authenticated = ログインした利用者。行は 20260911080909 の RLS で絞られたもの）:
--   github_pull_requests
--     読める列   : id, org_id, github_repo_id, pr_number, pr_title, pr_state, additions, deletions,
--                  commits_count, merged_at, closed_at, pr_created_at, updated_at
--     読めない列 : pr_url, head_branch, base_branch, author_login, author_avatar_url
--                  （URL にはリポジトリ名が入る。ブランチ名・作者名からは人や顧客が分かる）
--   github_issues
--     読める列   : id, org_id, github_repo_id, issue_number, title, state, state_reason,
--                  issue_created_at, closed_at, github_updated_at, last_synced_at, created_at, updated_at
--     読めない列 : url, author_login, assignee_logins
--   anon: 両表とも、どの列も読めない（見える行は元から0件）。
--   service_role: 変更しない（全列を読み書きできる。Webhook 受信・照合 cron・通知に影響なし）。
--   insert / update / delete の権限は変更しない（authenticated には書込ポリシーが無く、書けないまま）。
--   リポジトリ名は github_repositories にあり、読めるのは接続した本人だけ（20260911080909 のまま）。
--   列の一覧は 20240205_000（PR 18列）と 20260911002110（Issue 16列）の定義で全列を読める／読めないに分けた。
--
--   github_installations: access_token / token_expires_at を列ごと削除する（使っていない列。値は0件）。
--     値が1件でも残っていれば適用を止める（下の確認）。
--
--   github_connection_status(p_org) … その組織に GitHub が接続されているかを1行で返す。
--     connected    = その組織にインストールが1件以上あるか
--     connected_by = 接続した人（created_by）/ connected_at = 接続した時刻（created_at）
--     is_me        = 呼んだ人が connected_by 本人か
--     インストールが複数あるときは、呼んだ人が接続したものを優先し、無ければいちばん古いもの
--     （created_at、同時刻なら id の順）を返す。理由: 呼んだ人がどれか1つでも接続していれば is_me を true に
--     したい（本人かどうかで画面の出し分けをするため）。それ以外の人には、いつ呼んでも同じ人・同じ時刻を返す。
--     返すのは、その組織の社内メンバー（owner/admin/member）にだけ。client・vendor・組織外・未ログインには0行。
--       0行にした理由: 行を返す関数なので「見てよいものが無い＝0行」が素直で、表を RLS で読んだときと
--       同じ振る舞いになる（例外にして呼び出し側にエラー処理を強いない）。未接続の組織の社内メンバーには
--       connected=false の1行を返すので、「未接続」と「見る権限が無い」は区別できる。
--     アカウント名・許可範囲・リポジトリの情報は返さない。
--     呼べるのは authenticated と service_role（service_role は組織のメンバーではないので0行）。anon は呼べない。
--     二要素認証: SECURITY DEFINER のため RLS の mfa_required_when_enrolled は通らない。PostgREST からの呼び出しは
--     20260907144900 の pre-request が止める（既存の SECURITY DEFINER の RPC と同じ扱い）。
--
-- 列ごとの権限の注意（将来この2表に列を足すとき）:
--   後から足した列は authenticated に自動では見えない（安全側）。見せてよい列を足したら明示的に grant select する。
--
-- 冪等: 表の select を外すと列ごとの select も一緒に外れるので、revoke → grant は何度流しても同じ状態になる。
--   drop column if exists / create or replace function。再実行安全。
-- 破壊的変更: github_installations の2列の削除（不可逆。末尾のロールバックで列は戻せるが中身は戻らない）。
--   列ごとの権限と RPC は可逆。
-- 適用順（重要）: 読む側の画面が PR・Issue の列を並べて取るようになり、本番に出たあとで適用する。
--   先に適用すると、全列を取る今の読み方が権限エラーになり、タスク詳細の PR・Issue の一覧が出なくなる。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) github_pull_requests: 表の select を外し、読んでよい列だけを authenticated に許可する
--   表レベルの select が残っていると列ごとの許可は意味を持たないので、先に表レベルを外す。
-- -----------------------------------------------------------------------------
revoke select on table public.github_pull_requests from anon, authenticated;
grant select (
  id,
  org_id,
  github_repo_id,
  pr_number,
  pr_title,
  pr_state,
  additions,
  deletions,
  commits_count,
  merged_at,
  closed_at,
  pr_created_at,
  updated_at
) on table public.github_pull_requests to authenticated;

-- -----------------------------------------------------------------------------
-- 2) github_issues: 同じく読んでよい列だけを authenticated に許可する
-- -----------------------------------------------------------------------------
revoke select on table public.github_issues from anon, authenticated;
grant select (
  id,
  org_id,
  github_repo_id,
  issue_number,
  title,
  state,
  state_reason,
  issue_created_at,
  closed_at,
  github_updated_at,
  last_synced_at,
  created_at,
  updated_at
) on table public.github_issues to authenticated;

-- 確認: 読めない列が anon / authenticated にまだ読める状態なら、適用を止める
--   （表の select が別の付与者から残っている等で、列を絞れていない場合）
do $$
declare
  v_open text;
begin
  select string_agg(format('%s.%s(%s)', t.tbl, t.col, r.rol), ', ')
    into v_open
    from (values
            ('github_pull_requests', 'pr_url'),
            ('github_pull_requests', 'head_branch'),
            ('github_pull_requests', 'base_branch'),
            ('github_pull_requests', 'author_login'),
            ('github_pull_requests', 'author_avatar_url'),
            ('github_issues', 'url'),
            ('github_issues', 'author_login'),
            ('github_issues', 'assignee_logins')
         ) as t(tbl, col)
   cross join (values ('anon'), ('authenticated')) as r(rol)
   where has_column_privilege(r.rol, format('public.%I', t.tbl), t.col, 'select');

  if v_open is not null then
    raise exception 'github column grants: 読めない列がまだ読めます: %', v_open;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3) github_installations: 使っていない access_token / token_expires_at を削除する
--   値が残っていれば止める（消した列の中身は戻せないため）。列が既に無ければ何もしない。
-- -----------------------------------------------------------------------------
do $$
declare
  v_has_values boolean := false;
  v_col text;
begin
  foreach v_col in array array['access_token', 'token_expires_at'] loop
    if not v_has_values and exists (
      select 1 from pg_attribute
      where attrelid = 'public.github_installations'::regclass
        and attname = v_col and attnum > 0 and not attisdropped
    ) then
      execute format('select exists (select 1 from public.github_installations where %I is not null)', v_col)
        into v_has_values;
    end if;
  end loop;

  if v_has_values then
    raise exception 'github_installations の access_token / token_expires_at に値があります。削除せずに止めます';
  end if;
end $$;

alter table public.github_installations drop column if exists access_token;
alter table public.github_installations drop column if exists token_expires_at;

-- -----------------------------------------------------------------------------
-- 4) 接続状態の RPC: github_connection_status(p_org)
--   SECURITY DEFINER: RLS を通らずに github_installations を読む（接続した本人以外の社内メンバーにも
--   「接続済みか・誰が・いつ」だけは返すため）。返す列は上の4つだけ。
-- -----------------------------------------------------------------------------
create or replace function public.github_connection_status(p_org uuid)
  returns table (
    connected    boolean,
    connected_by uuid,
    connected_at timestamptz,
    is_me        boolean
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- 社内メンバーでなければ、最後の where で0行になる。
  -- インストールが複数あるときは、呼んだ人が接続したものを優先し、無ければいちばん古いもの（created_at, id の順）。
  select
    i.id is not null                           as connected,
    i.created_by                               as connected_by,
    i.created_at                               as connected_at,
    coalesce(i.created_by = auth.uid(), false) as is_me
  from (select 1) as one
  left join lateral (
    select gi.id, gi.created_by, gi.created_at
      from public.github_installations gi
     where gi.org_id = p_org
     order by coalesce(gi.created_by = auth.uid(), false) desc, gi.created_at, gi.id
     limit 1
  ) i on true
  where public.app_is_org_internal(p_org);
$$;

comment on function public.github_connection_status(uuid) is
  '組織に GitHub が接続されているか・接続した人・接続した時刻・呼んだ人が接続した本人かを1行で返す。社内メンバー(owner/admin/member)以外には0行。アカウント名・許可範囲・リポジトリは返さない';

revoke all on function public.github_connection_status(uuid) from public, anon;
grant execute on function public.github_connection_status(uuid) to authenticated, service_role;

-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_github_column_grants.sh（全 PASS）
--      RED=1 を付けると本 migration 抜きで流し、変わるはずの assert（chg_*）が全て落ちることを確認できる。
--   1) 適用前に、本番の2表の列が上の「読める列＋読めない列」と同じかを確かめる
--      （本番にだけある列があると、その列は authenticated に読めなくなる）:
--        select table_name, count(*), string_agg(column_name, ', ' order by ordinal_position)
--          from information_schema.columns
--         where table_schema = 'public' and table_name in ('github_pull_requests', 'github_issues')
--         group by table_name;
--      → github_pull_requests 18列、github_issues 16列。
--      あわせて、戻すときのために今の表の権限を控えておく:
--        select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
--          from information_schema.role_table_grants
--         where table_schema = 'public' and table_name in ('github_pull_requests', 'github_issues')
--         group by table_name, grantee;
--   2) 適用後:
--        select has_table_privilege('authenticated', 'public.github_pull_requests', 'select');        → false
--        select has_column_privilege('authenticated', 'public.github_pull_requests', 'pr_title', 'select'); → true
--        select has_column_privilege('authenticated', 'public.github_issues', 'url', 'select');       → false
--        select has_function_privilege('anon', 'public.github_connection_status(uuid)', 'execute');  → false
--        select count(*) from information_schema.columns where table_schema = 'public'
--           and table_name = 'github_installations' and column_name in ('access_token', 'token_expires_at'); → 0
--   3) 画面: タスク詳細の PR・Issue の一覧が、接続した本人には従来どおり、それ以外の社内メンバーには
--      番号・タイトル・状態・日付だけで出ること。
--
-- ロールバック（手動・必要時のみ。本 migration の前＝20260911080909 適用後の状態へ戻す）。
-- ※ 不可逆: github_installations の access_token / token_expires_at は、列は戻せるが中身は戻らない（空の列が戻る）。適用時は値0件を確かめてから消している。
-- ※ 戻すと、authenticated が PR・Issue の全列（URL・ブランチ名・作者名・担当者名）を再び読める状態に戻る（見える行は RLS のまま）。
-- ※ anon の表の select も Supabase の既定どおりに戻す（anon に見える行は RLS で0件のまま）。検証 1 で控えた権限と違えば、それに合わせる。
-- ※ 表の select を外すと列ごとの select も外れるので、外してから表の select を付け直す。
--   drop function if exists public.github_connection_status(uuid);
--   alter table public.github_installations add column if not exists access_token text;
--   alter table public.github_installations add column if not exists token_expires_at timestamptz;
--   revoke select on table public.github_issues from anon, authenticated;
--   grant select on table public.github_issues to anon, authenticated;
--   revoke select on table public.github_pull_requests from anon, authenticated;
--   grant select on table public.github_pull_requests to anon, authenticated;
-- =============================================================================
