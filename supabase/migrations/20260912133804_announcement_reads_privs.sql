-- =============================================================================
-- お知らせの既読（announcement_reads）: 本人は自分の既読を付け直せる・anon は触れない
--
-- 規則:
--   既読の行を読めるのは本人だけ・付けられるのは本人の分だけ（読む・付けるポリシーはそのまま）。
--   本人は自分の行を書き換えられる（user_id は本人のまま）。ベル（useAnnouncements.ts）は既読を
--     upsert（insert … on conflict (announcement_id, user_id) do update）で付けるので、同じお知らせを2回既読にしても通る。
--   消すポリシーは無い（お知らせを消すと、外部キーの on delete cascade で既読も消える）。
--   二要素認証の RESTRICTIVE（mfa_required_when_enrolled）は変えない。
--   表の権限: anon は何も持たない。authenticated は truncate / references / trigger を持たない
--     （select / insert / update / delete はそのまま）。service_role はそのまま。
--
-- 読み書きするアプリの箇所: ベル（useAnnouncements.ts）が、ログイン中の本人のセッションで自分の既読を読み、upsert で付ける。
--   運営画面のお知らせ（page.tsx）は service_role で既読の数を読む。
--
-- ロック: 先頭で announcement_reads を access exclusive で押さえてから変える（ポリシーの追加は表の access exclusive が要る）。
--   待つのは 3 秒まで。取れなければ全体を取り消すので、流し直す。DO 文の中で取る（空の DB から順に流す確認は
--   トランザクションで包まないため。本番の適用は1トランザクションなので、ロックは最後まで持つ）。
-- 冪等: revoke・drop policy if exists → create policy。2回流しても同じ。
-- 可逆: 節 1〜2 の末尾のロールバック節（後ろの節から順に流す）。行の中身は変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: ロックと、今のポリシーの確認（何も変えない）
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.announcement_reads in access exclusive mode;
end $$;

-- 今のポリシーが次の形であることを確かめる。違えば止める（本番だけにある手直しを上書きしないため）。
--   条件は、空白をつめて「public.」を外した文字列で比べる。
--   "Users can mark announcements read"（public・INSERT・本人の行）と "Users can read own announcement_reads"
--     （public・SELECT・本人の行）: 20260309_000_announcements.sql の形
--   mfa_required_when_enrolled（RESTRICTIVE・authenticated・ALL）: 20260907142526_mfa_rls_enforcement.sql の形
--   本 migration の "Users can update own announcement_reads" は、あれば本 migration の形であること
do $$
declare
  v_text text;
begin
  select string_agg(format('%s|%s|%s|%s|%s|%s', p.policyname, p.permissive, p.roles::text, p.cmd,
                           regexp_replace(replace(coalesce(p.qual, ''), 'public.', ''), '\s+', ' ', 'g'),
                           regexp_replace(replace(coalesce(p.with_check, ''), 'public.', ''), '\s+', ' ', 'g')),
                    ' / ' order by p.policyname collate "C")
    into v_text
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'announcement_reads'
     and p.policyname <> 'Users can update own announcement_reads';

  if v_text is distinct from
       'Users can mark announcements read|PERMISSIVE|{public}|INSERT||(user_id = auth.uid()) / '
       'Users can read own announcement_reads|PERMISSIVE|{public}|SELECT|(user_id = auth.uid())| / '
       'mfa_required_when_enrolled|RESTRICTIVE|{authenticated}|ALL|( SELECT mfa_satisfied() AS mfa_satisfied)|( SELECT mfa_satisfied() AS mfa_satisfied)' then
    raise exception 'announcement reads privs: 今のポリシーが想定の形ではありません: %', coalesce(v_text, '(なし)');
  end if;

  select format('%s|%s|%s|%s|%s', p.permissive, p.roles::text, p.cmd,
                regexp_replace(replace(coalesce(p.qual, ''), 'public.', ''), '\s+', ' ', 'g'),
                regexp_replace(replace(coalesce(p.with_check, ''), 'public.', ''), '\s+', ' ', 'g'))
    into v_text
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'announcement_reads'
     and p.policyname = 'Users can update own announcement_reads';

  if v_text is not null
     and v_text <> 'PERMISSIVE|{authenticated}|UPDATE|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))' then
    raise exception 'announcement reads privs: "Users can update own announcement_reads" が本 migration の形ではありません: %', v_text;
  end if;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる。確認は何も変えない）
-- =============================================================================
-- 節 1: 表の権限 … anon は何も持たない・authenticated は truncate / references / trigger を持たない
--   （truncate は RLS を通らずに全行を消せる）
-- =============================================================================

revoke all on table public.announcement_reads from anon;
revoke truncate, references, trigger on table public.announcement_reads from authenticated;

-- ロールバック（節 1。Supabase の既定の表の権限に戻す）:
--   grant all on table public.announcement_reads to anon;
--   grant truncate, references, trigger on table public.announcement_reads to authenticated;
-- =============================================================================
-- 節 2: 本人は自分の既読の行を書き換えられる（user_id は本人のまま）
--   upsert の2回目（on conflict do update）は、既にある行を本人の行として書き換えるので、このポリシーで通る。
--   (select auth.uid()) で包むと、行ごとでなく1文に1回だけ呼ぶ。
-- =============================================================================

drop policy if exists "Users can update own announcement_reads" on public.announcement_reads;

create policy "Users can update own announcement_reads"
  on public.announcement_reads
  as permissive
  for update
  to authenticated
  using ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );

-- ロールバック（節 2）:
--   drop policy if exists "Users can update own announcement_reads" on public.announcement_reads;
-- =============================================================================
-- 節 3: 末尾の確認（何も変えない）… ポリシーと表の権限が想定どおり。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
begin
  -- RLS が有効
  select c.relrowsecurity::text into v_text from pg_class c where c.oid = 'public.announcement_reads'::regclass;
  if v_text is distinct from 'true' then
    v_bad := v_bad || ' RLS=' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- ポリシー: 付ける・読む・本人の更新・二要素認証の RESTRICTIVE の4つだけ（消すポリシーは無い）
  select string_agg(format('%s|%s|%s|%s|%s|%s', p.policyname, p.permissive, p.roles::text, p.cmd,
                           regexp_replace(replace(coalesce(p.qual, ''), 'public.', ''), '\s+', ' ', 'g'),
                           regexp_replace(replace(coalesce(p.with_check, ''), 'public.', ''), '\s+', ' ', 'g')),
                    ' / ' order by p.policyname collate "C")
    into v_text
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'announcement_reads';
  if v_text is distinct from
       'Users can mark announcements read|PERMISSIVE|{public}|INSERT||(user_id = auth.uid()) / '
       'Users can read own announcement_reads|PERMISSIVE|{public}|SELECT|(user_id = auth.uid())| / '
       'Users can update own announcement_reads|PERMISSIVE|{authenticated}|UPDATE|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid)) / '
       'mfa_required_when_enrolled|RESTRICTIVE|{authenticated}|ALL|( SELECT mfa_satisfied() AS mfa_satisfied)|( SELECT mfa_satisfied() AS mfa_satisfied)' then
    v_bad := v_bad || ' ポリシー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 表の権限: anon と PUBLIC には1つも無い・authenticated に truncate / references / trigger が無い
  select string_agg(g.who || ':' || g.priv, ',' order by g.who, g.priv)
    into v_text
    from (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who,
                 a.privilege_type as priv
            from pg_class c, aclexplode(c.relacl) a
           where c.oid = 'public.announcement_reads'::regclass) g
   where g.who in ('PUBLIC', 'anon')
      or (g.who = 'authenticated' and g.priv in ('TRUNCATE', 'REFERENCES', 'TRIGGER'));
  if v_text is not null then
    v_bad := v_bad || ' 残っている表の権限: ' || v_text || ';';
  end if;

  if v_bad <> '' then
    raise exception 'announcement reads privs: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 3）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_announcement_reads_privs.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番・読むだけ）: ポリシーが節 0 の形・表の権限:
--        select policyname, permissive, roles, cmd, qual, with_check
--          from pg_policies where schemaname = 'public' and tablename = 'announcement_reads' order by policyname;
--        select relacl from pg_class where oid = 'public.announcement_reads'::regclass;
--   2) ドライラン（本番・最後に rollback）: begin; → 本 migration → 同じトランザクションで持っているロック:
--        select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
--         where l.pid = pg_backend_pid() and l.locktype = 'relation' and l.granted
--           and c.relnamespace = 'public'::regnamespace order by 1, 2;
--      → announcement_reads の AccessExclusiveLock のほかは AccessShareLock だけ。1) で適用後の形を見てから rollback;
--   3) 適用後（本番）: 節 3 が通る。1) で、"Users can update own announcement_reads"（authenticated・UPDATE）が増え、
--      relacl に anon が無く、authenticated に D（truncate）・x（references）・t（trigger）が無い。
--   4) 画面: ベルでお知らせを既読にする → 同じお知らせをもう一度既読にする／「すべて既読」を2回押しても
--      エラーにならない（ブラウザの開発者ツールで announcement_reads への POST が 2xx）。
-- =============================================================================
