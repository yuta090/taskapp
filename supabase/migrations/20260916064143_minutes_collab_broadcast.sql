-- =============================================================================
-- 議事録の同時編集: private チャネル meeting-minutes:<会議ID> で broadcast も許可する
--
-- 目的: 同じ会議の議事録を開いている社内メンバーどうしが、打った文字とカーソルを送り合えるようにする。
--   運びは Supabase Realtime の broadcast で、**在席（「〇〇さんが書いています」）と同じチャネルに相乗り**する
--   （同じ名前のチャネルには1つのつなぎ先から2回入れないため、別チャネルにはできない）。
--   いまのポリシー2本は `extension = 'presence'` に限っているので、broadcast は送ることも受け取ることもできない。
--
-- 規則:
--   1) 既存のポリシー2本（meeting_minutes_presence_select / _insert）の条件を
--        `extension = 'presence'` → `extension in ('presence','broadcast')` に広げるだけ。
--      判定関数 public.app_can_track_meeting_minutes(text) は**そのまま使い回す**（作り直さない）。
--      つまり参加できる人は今までと**まったく同じ**: その会議の space に書ける人（app_can_write_space =
--        社内メンバーで space の役割が admin / editor。役割が無い社内メンバーは editor 扱い）で、
--        二要素認証の条件（mfa_satisfied）も満たす人だけ。
--      viewer・相手先（client）・他の組織・未ログイン（anon）は、当てはまるポリシーが無いので参加できない。
--   2) 権限は広がらない: 同じ組織の editor は**いまでも議事録の本文を丸ごと上書きできる**（meetings_update_member）。
--      同時編集で送れるのは同じ議事録の中身だけなので、できることが増えるわけではない。
--   3) 列（meetings.minutes_md）への保存はこれまでどおり表の RLS と更新時刻の突き合わせで守る。
--      Realtime 側に権威は無い（壊れた更新を送られても防げない）ので、受け取る側は取り込みに失敗したら
--      同時編集をやめて1人で書く形へ落ちる（src/lib/collab/session.ts）。
--   4) publication（supabase_realtime。表の変更を配る仕組み）には触らない。realtime.messages の RLS も変えない。
--
-- ロック: トリガーは作らない。drop policy / create policy が realtime.messages を access exclusive で
--   一瞬だけ押さえる（その間、Realtime の realtime.messages の読み書きは待つ）。public.meetings は触らない。
-- 冪等: 節 0 は「広げる前」と「広げた後」の両方を通す。drop policy if exists → create policy。2回流しても同じ。
-- 可逆: 節 3 のロールバックで presence だけに戻せる。戻すと同時編集が止まるだけで、
--   在席表示と議事録の保存には影響しない。
-- =============================================================================

set local lock_timeout = '3s';


-- =============================================================================
-- 節 0: 写し元と同じ状態か確かめる（違えば何もせず止める）
--
-- 本番のポリシーが、この migration の写し元（20260912120140_meeting_minutes_presence.sql）と
-- 同じ形であることを先に確かめる。手で直されていた場合に、黙って上書きしないため。
-- =============================================================================

do $$
declare
  r        record;
  v_text   text;
  v_found  int := 0;
  v_quoted text[];
begin
  if to_regprocedure('public.app_can_track_meeting_minutes(text)') is null then
    raise exception '中止: public.app_can_track_meeting_minutes(text) がありません（先に 20260912120140 を適用してください）';
  end if;

  for r in
    select p.policyname, p.cmd, p.roles::text as roles, p.permissive,
           coalesce(p.qual, p.with_check) as expr
      from pg_policies p
     where p.schemaname = 'realtime' and p.tablename = 'messages'
       and p.policyname in ('meeting_minutes_presence_select', 'meeting_minutes_presence_insert')
  loop
    v_found := v_found + 1;
    v_text := r.policyname || ': ' || r.expr;

    if r.roles is distinct from '{authenticated}' or r.permissive is distinct from 'PERMISSIVE' then
      raise exception '中止: ポリシーの対象者か種類が写し元と違います（%: % / %）', r.policyname, r.roles, r.permissive;
    end if;

    -- 判定関数をチャネル名で呼んでいること。呼び先が差し替えられていたら止める
    if r.expr not like '%app_can_track_meeting_minutes(%' or r.expr not like '%realtime.topic()%' then
      raise exception '中止: ポリシーが app_can_track_meeting_minutes(realtime.topic()) を呼んでいません（%）', v_text;
    end if;

    -- 条件を緩める「または」が足されていないこと（and だけで繋がっている前提）
    if r.expr ~* '\yor\y' then
      raise exception '中止: ポリシーの条件に or が足されています（%）', v_text;
    end if;

    -- 出てくる文字列は presence と broadcast だけ。ほかの extension を足されていたら止める
    select array_agg(distinct m[1] order by m[1])
      into v_quoted
      from regexp_matches(r.expr, '''([^'']+)''', 'g') as m;
    if v_quoted is null
       or exists (select 1 from unnest(v_quoted) q where q not in ('presence', 'broadcast'))
       or not ('presence' = any(v_quoted)) then
      raise exception '中止: ポリシーの extension の条件が写し元と違います（%）', v_text;
    end if;
  end loop;

  if v_found <> 2 then
    raise exception '中止: meeting_minutes_presence_* のポリシーが 2 本ありません（% 本）', v_found;
  end if;
end $$;

-- ロールバック（節 0）: なし（確かめるだけで、何も変えない）


-- =============================================================================
-- 節 1: ポリシー2本の条件を broadcast まで広げる
-- =============================================================================

drop policy if exists meeting_minutes_presence_select on realtime.messages;
create policy meeting_minutes_presence_select
  on realtime.messages
  as permissive
  for select
  to authenticated
  using (
    realtime.messages.extension in ('presence', 'broadcast')
    and (select public.app_can_track_meeting_minutes(realtime.topic()))
  );

drop policy if exists meeting_minutes_presence_insert on realtime.messages;
create policy meeting_minutes_presence_insert
  on realtime.messages
  as permissive
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and (select public.app_can_track_meeting_minutes(realtime.topic()))
  );

comment on function public.app_can_track_meeting_minutes(text) is
  'Realtime の private チャネル meeting-minutes:<会議ID> の認可（realtime.messages のポリシーが呼ぶ。在席と同時編集の両方）: その会議の space に書ける人（app_can_write_space）で、二要素認証の条件（mfa_satisfied）を満たすときだけ true。名前の形が違えば false';

-- ロールバック（節 1。presence だけに戻す）:
--   drop policy if exists meeting_minutes_presence_select on realtime.messages;
--   create policy meeting_minutes_presence_select on realtime.messages as permissive for select to authenticated
--     using (realtime.messages.extension = 'presence' and (select public.app_can_track_meeting_minutes(realtime.topic())));
--   drop policy if exists meeting_minutes_presence_insert on realtime.messages;
--   create policy meeting_minutes_presence_insert on realtime.messages as permissive for insert to authenticated
--     with check (realtime.messages.extension = 'presence' and (select public.app_can_track_meeting_minutes(realtime.topic())));


-- =============================================================================
-- 節 2: 末尾の確認（何も変えない）… RLS が有効・ポリシー2本・条件に presence と broadcast の両方。違えば止める
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
begin
  if not coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('realtime.messages')), false) then
    v_bad := v_bad || ' realtime.messages の RLS が有効ではありません;';
  end if;

  select string_agg(format('%s:%s:%s:%s:ok=%s', p.policyname, p.cmd, p.permissive, p.roles::text,
                           (coalesce(p.qual, p.with_check) like '%''presence''%'
                            and coalesce(p.qual, p.with_check) like '%''broadcast''%'
                            and coalesce(p.qual, p.with_check) like '%app_can_track_meeting_minutes(%topic()%')::text),
                    ',' order by p.policyname)
    into v_text
    from pg_policies p
   where p.schemaname = 'realtime' and p.tablename = 'messages'
     and p.policyname in ('meeting_minutes_presence_select', 'meeting_minutes_presence_insert');

  if v_text is distinct from
     'meeting_minutes_presence_insert:INSERT:PERMISSIVE:{authenticated}:ok=true,'
     'meeting_minutes_presence_select:SELECT:PERMISSIVE:{authenticated}:ok=true' then
    v_bad := v_bad || ' ポリシー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 判定関数はそのまま（実行できるのは authenticated だけ）
  if has_function_privilege('anon', 'public.app_can_track_meeting_minutes(text)', 'execute')
     or has_function_privilege('service_role', 'public.app_can_track_meeting_minutes(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_can_track_meeting_minutes(text)', 'execute') then
    v_bad := v_bad || ' app_can_track_meeting_minutes の実行権が想定と違います;';
  end if;

  -- 形の違うチャネル名は、例外を出さずに false のまま（広げても変わっていないこと）
  select string_agg(coalesce(t, '(null)'), ',') into v_text
    from unnest(array['meeting-minutes:not-a-uuid', 'meeting-minutes:', '', null,
                      'other:00000000-0000-0000-0000-000000000000']) as t
   where public.app_can_track_meeting_minutes(t) is distinct from false;
  if v_text is not null then
    v_bad := v_bad || ' false にならない名前: ' || v_text || ';';
  end if;

  if v_bad <> '' then
    raise exception 'minutes collab broadcast: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 2）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash scripts/verify-migrations-from-scratch.sh（realtime の代役は supabase/tests/_local_bootstrap.sql）。
--   1) 適用前（本番）: scripts/apply-migration.sh のドライラン（BEGIN → 実行 → ROLLBACK）。節 0 が通ることを確かめる。
--   2) 適用後（本番）:
--        select policyname, cmd, roles, qual, with_check from pg_policies
--         where schemaname = 'realtime' and tablename = 'messages' order by policyname;
--          → 2 行。どちらの条件にも 'presence' と 'broadcast' が入っている
--   3) 画面で（private チャネル・config: { private: true, broadcast: { self: false, ack: false } }）:
--        書ける社内メンバー2人が同じ会議の議事録を開く → 互いの文字とカーソルが見える。
--        viewer・相手先・他の組織の人 → チャネルに参加できない（画面は壊れず、1人で書く形のまま）。
--        二要素認証を登録した人のコード入力前（aal1）→ 参加できない。
-- =============================================================================
