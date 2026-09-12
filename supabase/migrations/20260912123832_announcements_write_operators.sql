-- =============================================================================
-- お知らせ（announcements）を作る・変える・消すのは運営（superadmin）だけ
--
-- 規則:
--   announcements に書き込める（insert / update / delete）のは運営と service_role だけ。全体向け（org_id が空）も
--     組織向けも同じ。運営は全部の行を読める（作った行を返す・id で選んで消すのに要る）。
--   運営かどうかは public.rpc_is_superadmin()（SECURITY DEFINER・authenticated と service_role が実行できる）で決める。
--     ポリシーの中で profiles.is_superadmin を本人の権限では読まない。
--   読む側（"Users can read announcements"）は変えない: 公開中（published）の、全体向けと自分の組織向け。
--   二要素認証の RESTRICTIVE（mfa_required_when_enrolled）は変えない。
--   表の権限: anon は何も持たない。authenticated は truncate / references / trigger を持たない
--     （select / insert / update / delete はそのまま）。service_role はそのまま。
--
-- 書き込むアプリの箇所: 運営画面 /admin/announcements（AnnouncementsPageClient.tsx）が、ブラウザから運営本人の
--   セッションで insert（作った行を返す）と delete（id で選ぶ）をする。読むのはベル（useAnnouncements・ログイン中の人）と
--   運営画面のサーバー（page.tsx・service_role）。
--
-- ロック: 先頭で announcements を access exclusive で押さえてから変える（ポリシーの差し替えは表の access exclusive が要る）。
--   待つのは 3 秒まで。取れなければ全体を取り消すので、流し直す。DO 文の中で取る（空の DB から順に流す確認は
--   トランザクションで包まないため。本番の適用は1トランザクションなので、ロックは最後まで持つ）。
-- 冪等: drop policy if exists → create policy・revoke。2回流しても同じ。
-- 可逆: 節 1〜2 の末尾のロールバック節（後ろの節から順に流す）。行の中身は変えない。
--   節 1 のロールバックは、土台の migration（20260309_000_announcements.sql）の書き込みのポリシーに戻す
--   （節 0 の 1) の形には戻さない）。
-- =============================================================================


-- =============================================================================
-- 節 0: ロックと、差し替える書き込みのポリシー・判定関数の確認（何も変えない）
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.announcements in access exclusive mode;
end $$;

-- 読む側（"Users can read announcements"）以外の PERMISSIVE のポリシーが、次のどれか1つだけであることを確かめる。
--   違えば止める（本番だけにある手直しを上書きしないため。止まったら pg_policies を見る）。
--   条件（qual / with_check）は、空白をつめて「public.」を外した文字列の md5 で比べる:
--     1) "Admins can manage announcements"・public・ALL・using と with check が同じ条件: 本番で 2026-09-12 に読んだ形
--     2) "Admins can manage announcements"・public・ALL・with check なし: 20260309_000_announcements.sql の形
--     3) "Superadmins can manage announcements"・authenticated・ALL: 本 migration の形
-- 判定関数 rpc_is_superadmin() の本文が 20260305_000_admin_superadmin.sql と同じで、SECURITY DEFINER であることも確かめる。
do $$
declare
  v_text text;
begin
  select string_agg(format('%s|%s|%s|%s|%s', p.policyname, p.roles::text, p.cmd,
                           md5(regexp_replace(replace(coalesce(p.qual, ''), 'public.', ''), '\s+', ' ', 'g')),
                           md5(regexp_replace(replace(coalesce(p.with_check, ''), 'public.', ''), '\s+', ' ', 'g'))),
                    ', ' order by p.policyname collate "C")
    into v_text
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'announcements'
     and p.permissive = 'PERMISSIVE'
     and p.policyname <> 'Users can read announcements';

  if v_text is null or v_text not in (
       'Admins can manage announcements|{public}|ALL|d750a57adc3e059e647c10289ec4b62d|d750a57adc3e059e647c10289ec4b62d',
       'Admins can manage announcements|{public}|ALL|d19ab6fce3af0b64289861a8838db0f7|d41d8cd98f00b204e9800998ecf8427e',
       'Superadmins can manage announcements|{authenticated}|ALL|98e7d5aeb92dc955b9351ec6565cac86|98e7d5aeb92dc955b9351ec6565cac86'
     ) then
    raise exception 'announcements write operators: 書き込みのポリシーが想定の形ではありません: %', coalesce(v_text, '(なし)');
  end if;

  select format('%s|%s', md5(p.prosrc), p.prosecdef::text)
    into v_text
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_is_superadmin()');

  if v_text is distinct from '099e64fa3f0416d61a85b09ba1f2360d|true' then
    raise exception 'announcements write operators: rpc_is_superadmin() が土台の定義と違います: %', coalesce(v_text, '(なし)');
  end if;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる。確認は何も変えない）
-- =============================================================================
-- 節 1: 書き込みのポリシー … 運営だけ（authenticated のうち rpc_is_superadmin() が true の人）
--   読む側のポリシーと二要素認証の RESTRICTIVE は触らない。
--   (select …) で包むと、行ごとでなく1文に1回だけ呼ぶ。
-- =============================================================================

drop policy if exists "Admins can manage announcements" on public.announcements;
drop policy if exists "Superadmins can manage announcements" on public.announcements;

create policy "Superadmins can manage announcements"
  on public.announcements
  as permissive
  for all
  to authenticated
  using ( (select public.rpc_is_superadmin()) )
  with check ( (select public.rpc_is_superadmin()) );

-- ロールバック（節 1。20260309_000_announcements.sql の書き込みのポリシーに戻す）:
--   drop policy if exists "Superadmins can manage announcements" on public.announcements;
--   create policy "Admins can manage announcements" on public.announcements for all using ( org_id in ( select org_id from public.org_memberships where user_id = auth.uid() and role = 'admin' ) );
-- =============================================================================
-- 節 2: 表の権限 … anon は何も持たない・authenticated は truncate / references / trigger を持たない
--   （truncate は RLS を通らずに全行を消せる）
-- =============================================================================

revoke all on table public.announcements from anon;
revoke truncate, references, trigger on table public.announcements from authenticated;

-- ロールバック（節 2。Supabase の既定の表の権限に戻す）:
--   grant all on table public.announcements to anon;
--   grant truncate, references, trigger on table public.announcements to authenticated;
-- =============================================================================
-- 節 3: 末尾の確認（何も変えない）… ポリシー・表の権限・判定関数が想定どおり。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
begin
  -- RLS が有効
  select c.relrowsecurity::text into v_text from pg_class c where c.oid = 'public.announcements'::regclass;
  if v_text is distinct from 'true' then
    v_bad := v_bad || ' RLS=' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- ポリシー: 運営の書き込み・読む側・二要素認証の RESTRICTIVE の3つだけ。運営の書き込みの条件は
  --   using・with check とも rpc_is_superadmin() だけ
  select string_agg(format('%s|%s|%s|%s', p.policyname, p.permissive, p.roles::text, p.cmd)
                      || case when p.policyname = 'Superadmins can manage announcements'
                              then '|' || md5(regexp_replace(replace(coalesce(p.qual, ''), 'public.', ''), '\s+', ' ', 'g'))
                                   || '|' || md5(regexp_replace(replace(coalesce(p.with_check, ''), 'public.', ''), '\s+', ' ', 'g'))
                              else '' end,
                    ', ' order by p.policyname collate "C")
    into v_text
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'announcements';
  if v_text is distinct from
       'Superadmins can manage announcements|PERMISSIVE|{authenticated}|ALL|98e7d5aeb92dc955b9351ec6565cac86|98e7d5aeb92dc955b9351ec6565cac86, '
       'Users can read announcements|PERMISSIVE|{public}|SELECT, '
       'mfa_required_when_enrolled|RESTRICTIVE|{authenticated}|ALL' then
    v_bad := v_bad || ' ポリシー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 表の権限: anon と PUBLIC には1つも無い・authenticated に truncate / references / trigger が無い
  select string_agg(g.who || ':' || g.priv, ',' order by g.who, g.priv)
    into v_text
    from (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who,
                 a.privilege_type as priv
            from pg_class c, aclexplode(c.relacl) a
           where c.oid = 'public.announcements'::regclass) g
   where g.who in ('PUBLIC', 'anon')
      or (g.who = 'authenticated' and g.priv in ('TRUNCATE', 'REFERENCES', 'TRIGGER'));
  if v_text is not null then
    v_bad := v_bad || ' 残っている表の権限: ' || v_text || ';';
  end if;

  -- 判定関数: SECURITY DEFINER で、authenticated が実行できる（ポリシーから呼ぶ）
  select format('%s|%s', p.prosecdef::text, has_function_privilege('authenticated', p.oid, 'execute')::text)
    into v_text
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_is_superadmin()');
  if v_text is distinct from 'true|true' then
    v_bad := v_bad || ' rpc_is_superadmin: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  if v_bad <> '' then
    raise exception 'announcements write operators: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 3）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_announcements_write_operators.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番・読むだけ）: 書き込みのポリシーが節 0 の 1) の形・表の権限・判定関数:
--        select policyname, permissive, roles, cmd,
--               md5(regexp_replace(replace(coalesce(qual, ''), 'public.', ''), '\s+', ' ', 'g')) as qual_md5,
--               md5(regexp_replace(replace(coalesce(with_check, ''), 'public.', ''), '\s+', ' ', 'g')) as check_md5
--          from pg_policies where schemaname = 'public' and tablename = 'announcements' order by policyname;
--        select relacl from pg_class where oid = 'public.announcements'::regclass;
--        select md5(prosrc), prosecdef, proacl from pg_proc where oid = 'public.rpc_is_superadmin()'::regprocedure;
--   2) ドライラン（本番・最後に rollback）: begin; → 本 migration → 同じトランザクションで持っているロック:
--        select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
--         where l.pid = pg_backend_pid() and l.locktype = 'relation' and l.granted
--           and c.relnamespace = 'public'::regnamespace order by 1, 2;
--      → announcements の AccessExclusiveLock のほかは AccessShareLock だけ。1) で適用後の形を見てから rollback;
--   3) 適用後（本番）: 節 3 が通る。1) で、書き込みのポリシーは "Superadmins can manage announcements"（authenticated）、
--      relacl に anon が無く、authenticated に D（truncate）・x（references）・t（trigger）が無い。
--   4) 画面: 運営画面のお知らせで、全体向けと組織向けを作れて消せる（運営は二要素認証のコード入力済み）／
--      ログイン中の人のベルに、公開中の全体向けと自分の組織向けが出る。
-- =============================================================================
