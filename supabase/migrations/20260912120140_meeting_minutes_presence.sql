-- =============================================================================
-- 議事録の「〇〇さんが書いています」表示: Realtime Presence の private チャネル meeting-minutes:<会議ID> の認可
--
-- 目的: Web で同じ会議の議事録を開いている人どうしに、「いま書いている人」を見せる（Supabase Realtime の Presence）。
--   チャネルは private にする。private チャネルでは、参加（受け取る）と送信（track）のときに、Realtime が
--   authenticated の役割で realtime.messages を読み書きしてみて、RLS のポリシーで通るかどうかで判定する。
--   いまは realtime.messages にポリシーが1つも無い（= private チャネルには誰も参加できない）。
--
-- 規則:
--   1) public.app_can_track_meeting_minutes(p_topic text) returns boolean
--      チャネル名が 'meeting-minutes:<会議ID>' で、その会議の space に書ける人
--        （app_can_write_space: 社内メンバーで、space の役割が admin / editor。役割が無い社内メンバーは editor 扱い）で、
--        二要素認証の条件（mfa_satisfied: 登録済みなら aal2）も満たすときだけ true。
--      会議ID の部分が uuid の形（小文字の 8-4-4-4-12）でなければ、uuid に変えずに false（変換の例外を出さない）。
--        会議が無い・名前の頭が違う・空・null も false。
--      SECURITY DEFINER（会議を RLS を通らずに読む。ポリシーから呼ぶので、表のポリシーの読み合いを作らない）・
--        search_path = public・stable。
--      実行できるのは authenticated だけ（PUBLIC・anon・service_role には付けない。service_role は RLS を通らないので、
--        ポリシーから呼ばれることも無い）。
--   2) realtime.messages のポリシー 2 本（to authenticated・permissive）:
--        meeting_minutes_presence_select（for select）… 他の人の「書いています」を受け取る
--        meeting_minutes_presence_insert（for insert）… 自分の「書いています」を送る（track）
--      条件はどちらも extension = 'presence' かつ 1) が true（チャネル名は realtime.topic() で受け取る）。
--        関数は (select …) で包み、1回の判定で1度だけ呼ぶ。
--      broadcast（任意のメッセージの送受信）は許可しない。viewer・相手先（client）・他の組織・未ログイン（anon）は、
--        参加も送信もできない（当てはまるポリシーが無い = 拒否）。
--   Realtime は PostgREST を通らないので、PostgREST の二要素認証の事前チェック（mfa_pre_request）は効かない。
--     そのため 1) の中で mfa_satisfied() を見る。
--   ダッシュボードの Realtime の「Allow public access」は触らない（private チャネルの認可には関係しない。
--     切ると、既存の public チャネル（src/lib/hooks/useRealtimeResponses.ts）が使えなくなる）。
--   publication（supabase_realtime。表の変更を配る仕組み）にも触らない。realtime.messages の RLS は本番で既に有効
--     （節 3 で確かめる。無効ならポリシーが効かないので止める）。
--
-- ロック: 節を設けない（トリガーを作らない）。drop policy / create policy は realtime.messages を access exclusive で
--   一瞬だけ押さえる（その間、Realtime の realtime.messages の読み書きは待つ）。public.meetings は access share だけ。
-- 冪等: create or replace function・revoke / grant・drop policy if exists → create policy。2回流しても同じ。
-- 可逆: 各節の末尾のロールバック節（後ろの節から順に流す）。行の中身は変えない。
--   戻したときの影響: private チャネル meeting-minutes:* に誰も参加できなくなる（「書いています」が出ないだけで、
--   議事録の保存には関係しない）。
-- =============================================================================


-- =============================================================================
-- 節 1: チャネル名から「その会議の議事録に書ける人か」を判定する関数
-- =============================================================================

create or replace function public.app_can_track_meeting_minutes(p_topic text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
           -- 形が合うときだけ uuid に変える（合わなければ変えずに false）
           when p_topic ~ '^meeting-minutes:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
             exists (
               select 1
                 from public.meetings m
                where m.id = substr(p_topic, length('meeting-minutes:') + 1)::uuid
                  and public.app_can_write_space(m.space_id, m.org_id)
             )
             and public.mfa_satisfied()
           else false
         end;
$$;

comment on function public.app_can_track_meeting_minutes(text) is
  'Realtime の private チャネル meeting-minutes:<会議ID> の認可（realtime.messages のポリシーが呼ぶ）: その会議の space に書ける人（app_can_write_space）で、二要素認証の条件（mfa_satisfied）を満たすときだけ true。名前の形が違えば false';

-- 実行できるのは authenticated だけ
revoke all on function public.app_can_track_meeting_minutes(text) from public, anon, service_role;
grant execute on function public.app_can_track_meeting_minutes(text) to authenticated;

-- ロールバック（節 1。節 2 のポリシーを外したあとに流す）:
--   drop function if exists public.app_can_track_meeting_minutes(text);
-- =============================================================================
-- 節 2: realtime.messages のポリシー（presence の受け取りと送信だけ）
-- =============================================================================

drop policy if exists meeting_minutes_presence_select on realtime.messages;
create policy meeting_minutes_presence_select
  on realtime.messages
  as permissive
  for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and (select public.app_can_track_meeting_minutes(realtime.topic()))
  );

drop policy if exists meeting_minutes_presence_insert on realtime.messages;
create policy meeting_minutes_presence_insert
  on realtime.messages
  as permissive
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and (select public.app_can_track_meeting_minutes(realtime.topic()))
  );

-- ロールバック（節 2。ポリシーを外す）:
--   drop policy if exists meeting_minutes_presence_insert on realtime.messages;
--   drop policy if exists meeting_minutes_presence_select on realtime.messages;
-- =============================================================================
-- 節 3: 末尾の確認（何も変えない）… RLS が有効・ポリシー 2 本・関数の形と実行権・形の違う名前で false。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
  v_fn   regprocedure := to_regprocedure('public.app_can_track_meeting_minutes(text)');
begin
  -- realtime.messages の RLS が有効（無効だとポリシーは効かず、ログインした人は誰でも private チャネルに入れる）
  if not coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('realtime.messages')), false) then
    v_bad := v_bad || ' realtime.messages の RLS が有効ではありません;';
  end if;

  -- ポリシー 2 本: authenticated に・permissive。select は using、insert は with check に、presence と関数の判定
  select string_agg(format('%s:%s:%s:%s:using=%s:check=%s', p.policyname, p.cmd, p.permissive, p.roles::text,
                           (p.qual like '%''presence''%' and p.qual like '%app_can_track_meeting_minutes(%topic()%')::text,
                           (p.with_check like '%''presence''%' and p.with_check like '%app_can_track_meeting_minutes(%topic()%')::text),
                    ',' order by p.policyname)
    into v_text
    from pg_policies p
   where p.schemaname = 'realtime' and p.tablename = 'messages'
     and p.policyname in ('meeting_minutes_presence_select', 'meeting_minutes_presence_insert');
  if v_text is distinct from
     'meeting_minutes_presence_insert:INSERT:PERMISSIVE:{authenticated}:using=:check=true,'
     'meeting_minutes_presence_select:SELECT:PERMISSIVE:{authenticated}:using=true:check=' then
    v_bad := v_bad || ' ポリシー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  if v_fn is null then
    v_bad := v_bad || ' app_can_track_meeting_minutes: (なし);';
  else
    -- 関数: boolean を返す・SECURITY DEFINER・stable・search_path = public
    select format('returns_boolean=%s definer=%s volatility=%s config=%s',
                  (p.prorettype = 'boolean'::regtype)::text, p.prosecdef::text, p.provolatile::text,
                  coalesce(array_to_string(p.proconfig, ';'), ''))
      into v_text
      from pg_proc p
     where p.oid = v_fn;
    if v_text is distinct from 'returns_boolean=true definer=true volatility=s config=search_path=public' then
      v_bad := v_bad || ' app_can_track_meeting_minutes: ' || coalesce(v_text, '(なし)') || ';';
    end if;

    -- 実行できるのは authenticated だけ（PUBLIC・anon・service_role は実行できない）
    if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      v_bad := v_bad || ' app_can_track_meeting_minutes の実行権: '
               || coalesce((select p.proacl::text from pg_proc p where p.oid = v_fn), '(null)') || ';';
    end if;

    -- 形の違う名前・空・null は、例外を出さずに false
    select string_agg(coalesce(t, '(null)'), ',') into v_text
      from unnest(array['meeting-minutes:not-a-uuid', 'meeting-minutes:', '', null,
                        'other:00000000-0000-0000-0000-000000000000',
                        'meeting-minutes:00000000-0000-0000-0000-000000000000x']) as t
     where public.app_can_track_meeting_minutes(t) is distinct from false;
    if v_text is not null then
      v_bad := v_bad || ' false にならない名前: ' || v_text || ';';
    end if;
  end if;

  if v_bad <> '' then
    raise exception 'meeting minutes presence: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 3）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash scripts/verify-migrations-from-scratch.sh（realtime の代役は supabase/tests/_local_bootstrap.sql）。
--   1) 適用前（本番）: scripts/apply-migration.sh のドライラン（BEGIN → 実行 → ROLLBACK）で、
--      realtime.messages にポリシーを作れる（持ち主の権限がある）ことを先に確かめる。
--        select c.relowner::regrole, c.relrowsecurity from pg_class c where c.oid = 'realtime.messages'::regclass;
--   2) 適用後（本番）: 節 3 が通る。
--        select policyname, cmd, roles, qual, with_check from pg_policies
--         where schemaname = 'realtime' and tablename = 'messages' order by policyname;
--          → 2 行（meeting_minutes_presence_insert / meeting_minutes_presence_select）
--        select has_function_privilege('anon', 'public.app_can_track_meeting_minutes(text)', 'execute'),
--               has_function_privilege('authenticated', 'public.app_can_track_meeting_minutes(text)', 'execute');
--          → f / t
--   3) Realtime で実際に（画面から。private チャネル・config: { private: true }）:
--        書ける社内メンバー2人が同じ会議の議事録を開く → 互いに「書いています」が出る。
--        viewer・相手先・他の組織の人 → チャネルに参加できない（画面は壊れず、表示が出ないだけ）。
--        二要素認証を登録した人のコード入力前（aal1）→ 参加できない。
-- =============================================================================
