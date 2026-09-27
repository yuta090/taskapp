-- =============================================================================
-- Wiki の同時編集: private チャネル wiki-page:<ページID> の認可（在席と broadcast）
--
-- 目的: 同じ Wiki ページを開いている社内メンバーどうしが、議事録と同じように
--   「〇〇さんが書いています」を見せ合い、打った文字とカーソルを送り合えるようにする
--   （COEDITING_SPEC の PR3。議事録は 20260912120140 と 20260916064143 で入れた）。
--   いまは wiki-page:* に当てはまるポリシーが無いので、誰も参加できない。
--
-- 規則（議事録と同じ形。判定の中身だけ Wiki のページに変える）:
--   1) public.app_can_track_wiki_page(p_topic text) returns boolean
--      チャネル名が 'wiki-page:<ページID>' で、そのページの space に書ける人
--        （app_can_write_wiki_page = app_can_write_space: 社内メンバーで、space の役割が admin / editor。
--         役割が無い社内メンバーは editor 扱い。wiki_pages の更新のポリシーと同じ判定）で、
--        二要素認証の条件（mfa_satisfied: 登録済みなら aal2）も満たすときだけ true。
--      ページID の部分が uuid の形（小文字の 8-4-4-4-12）でなければ、uuid に変えずに false（変換の例外を出さない）。
--        ページが無い・名前の頭が違う・空・null も false。
--      SECURITY DEFINER（ページを RLS を通らずに読む。ポリシーから呼ぶので、表のポリシーの読み合いを作らない）・
--        search_path = public・stable。実行できるのは authenticated だけ。
--   2) realtime.messages のポリシー 2 本（to authenticated・permissive）:
--        wiki_page_collab_select（for select）… 相手の在席と打った内容を受け取る
--        wiki_page_collab_insert（for insert）… 自分の在席と打った内容を送る
--      条件はどちらも extension in ('presence','broadcast') かつ 1) が true。関数は (select …) で包む。
--      viewer・相手先（client）・他の組織・未ログイン（anon）は、当てはまるポリシーが無いので参加できない。
--   権限は広がらない: 同じ space の editor は、いまでもページの本文を丸ごと上書きできる（wiki_pages_update_member）。
--     送れるのは同じページの中身だけ。列（wiki_pages.body）への保存はこれまでどおり表の RLS と更新時刻の
--     突き合わせで守る。Realtime 側に権威は無いので、受け取る側は取り込みに失敗したら1人で書く形へ落ちる。
--   Realtime は PostgREST を通らないので、PostgREST の二要素認証の事前チェックは効かない。1) の中で mfa_satisfied() を見る。
--   議事録のポリシー（meeting_minutes_presence_*）・publication・realtime.messages の RLS の有効/無効には触らない。
--
-- ロック: トリガーは作らない。create policy が realtime.messages を access exclusive で一瞬だけ押さえる。
--   public.wiki_pages は触らない（関数が読むだけ）。
-- 冪等: create or replace function・revoke / grant・drop policy if exists → create policy。2回流しても同じ。
-- 可逆: 各節の末尾のロールバック（後ろの節から順に流す）。戻すと Wiki の同時編集と在席が止まるだけで、
--   Wiki の保存には影響しない（画面は1人で書く形に落ちる）。
-- =============================================================================

set local lock_timeout = '3s';


-- =============================================================================
-- 節 1: チャネル名から「その Wiki ページに書ける人か」を判定する関数
-- =============================================================================

create or replace function public.app_can_track_wiki_page(p_topic text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
           -- 形が合うときだけ uuid に変える（合わなければ変えずに false）
           when p_topic ~ '^wiki-page:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
             public.app_can_write_wiki_page(substr(p_topic, length('wiki-page:') + 1)::uuid)
             and public.mfa_satisfied()
           else false
         end;
$$;

comment on function public.app_can_track_wiki_page(text) is
  'Realtime の private チャネル wiki-page:<ページID> の認可（realtime.messages のポリシーが呼ぶ。在席と同時編集の両方）: そのページの space に書ける人（app_can_write_wiki_page）で、二要素認証の条件（mfa_satisfied）を満たすときだけ true。名前の形が違えば false';

-- 実行できるのは authenticated だけ
revoke all on function public.app_can_track_wiki_page(text) from public, anon, service_role;
grant execute on function public.app_can_track_wiki_page(text) to authenticated;

-- ロールバック（節 1。節 2 のポリシーを外したあとに流す）:
--   drop function if exists public.app_can_track_wiki_page(text);


-- =============================================================================
-- 節 2: realtime.messages のポリシー（在席と broadcast の受け取りと送信）
-- =============================================================================

drop policy if exists wiki_page_collab_select on realtime.messages;
create policy wiki_page_collab_select
  on realtime.messages
  as permissive
  for select
  to authenticated
  using (
    realtime.messages.extension in ('presence', 'broadcast')
    and (select public.app_can_track_wiki_page(realtime.topic()))
  );

drop policy if exists wiki_page_collab_insert on realtime.messages;
create policy wiki_page_collab_insert
  on realtime.messages
  as permissive
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and (select public.app_can_track_wiki_page(realtime.topic()))
  );

-- ロールバック（節 2。ポリシーを外す）:
--   drop policy if exists wiki_page_collab_insert on realtime.messages;
--   drop policy if exists wiki_page_collab_select on realtime.messages;


-- =============================================================================
-- 節 3: 末尾の確認（何も変えない）… RLS が有効・ポリシー 2 本・関数の形と実行権・形の違う名前で false。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
  v_fn   regprocedure := to_regprocedure('public.app_can_track_wiki_page(text)');
begin
  if not coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('realtime.messages')), false) then
    v_bad := v_bad || ' realtime.messages の RLS が有効ではありません;';
  end if;

  select string_agg(format('%s:%s:%s:%s:ok=%s', p.policyname, p.cmd, p.permissive, p.roles::text,
                           (coalesce(p.qual, p.with_check) like '%''presence''%'
                            and coalesce(p.qual, p.with_check) like '%''broadcast''%'
                            and coalesce(p.qual, p.with_check) like '%app_can_track_wiki_page(%topic()%')::text),
                    ',' order by p.policyname)
    into v_text
    from pg_policies p
   where p.schemaname = 'realtime' and p.tablename = 'messages'
     and p.policyname in ('wiki_page_collab_select', 'wiki_page_collab_insert');
  if v_text is distinct from
     'wiki_page_collab_insert:INSERT:PERMISSIVE:{authenticated}:ok=true,'
     'wiki_page_collab_select:SELECT:PERMISSIVE:{authenticated}:ok=true' then
    v_bad := v_bad || ' ポリシー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  if v_fn is null then
    v_bad := v_bad || ' app_can_track_wiki_page: (なし);';
  else
    select format('returns_boolean=%s definer=%s volatility=%s config=%s',
                  (p.prorettype = 'boolean'::regtype)::text, p.prosecdef::text, p.provolatile::text,
                  coalesce(array_to_string(p.proconfig, ';'), ''))
      into v_text
      from pg_proc p
     where p.oid = v_fn;
    if v_text is distinct from 'returns_boolean=true definer=true volatility=s config=search_path=public' then
      v_bad := v_bad || ' app_can_track_wiki_page: ' || coalesce(v_text, '(なし)') || ';';
    end if;

    if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      v_bad := v_bad || ' app_can_track_wiki_page の実行権: '
               || coalesce((select p.proacl::text from pg_proc p where p.oid = v_fn), '(null)') || ';';
    end if;

    -- 形の違う名前・空・null・議事録の部屋の名前は、例外を出さずに false
    select string_agg(coalesce(t, '(null)'), ',') into v_text
      from unnest(array['wiki-page:not-a-uuid', 'wiki-page:', '', null,
                        'meeting-minutes:00000000-0000-0000-0000-000000000000',
                        'wiki-page:00000000-0000-0000-0000-000000000000x']) as t
     where public.app_can_track_wiki_page(t) is distinct from false;
    if v_text is not null then
      v_bad := v_bad || ' false にならない名前: ' || v_text || ';';
    end if;
  end if;

  if v_bad <> '' then
    raise exception 'wiki page collab: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 3）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番）: scripts/apply-migration.sh のドライラン（BEGIN → 実行 → ROLLBACK）。
--   2) 適用後（本番）:
--        select policyname, cmd, roles, qual, with_check from pg_policies
--         where schemaname = 'realtime' and tablename = 'messages' order by policyname;
--          → 4 行（議事録の 2 本 ＋ wiki_page_collab_insert / wiki_page_collab_select）
--   3) 画面で: 書ける社内メンバー2人が同じ Wiki ページを開く → 互いの文字とカーソルが見える。
--        viewer・相手先・他の組織の人 → 参加できない（画面は壊れず、1人で書く形のまま）。
-- =============================================================================
