-- =============================================================================
-- 議事録を Web から安全に編集する: 会議の更新時刻を毎回進めるトリガーと、議事録の末尾に1文で足す関数
--
-- 規則:
--   1) meetings の行を update するたびに、updated_at を now() にする（BEFORE UPDATE トリガー）。
--      Web は議事録を「読んだときの updated_at のままの行だけ書く」で保存する
--        （.update({ minutes_md }).eq('id', id).eq('updated_at', 読んだ値)）。0 行なら「別の場所で更新されました」を出す。
--      MCP の minutes_update などは updated_at を書かないので、トリガーが無いと、その書き込みの後で Web が古い本文で
--        上書きしても気づけない。
--      rpc_parse_meeting_minutes / rpc_meeting_end は自分でも updated_at = now() を書く。トリガーが入れるのも同じ now()
--        （トランザクションの開始時刻）なので、値は変わらない（両方あってよい。2つの関数は変えない）。
--      書き手が updated_at を渡しても、トリガーの now() になる（いま渡している書き手は無い）。
--   2) rpc_minutes_append(p_meeting_id, p_org_id, p_space_id, p_content): 議事録（minutes_md）の末尾に p_content を足し、
--      更新後の行を1件返す。読んでから書くのではなく1文の update で足すので、同時に足しても片方が消えない。
--        本文が空（null か ''）なら区切りなしで入れる。そうでなければ空行（\n\n）を挟む。updated_at は 1) のトリガーが進める。
--        会議・組織・space の3つが合う行だけ変える。合わなければ何も変えず例外にする（'minutes append target not found'。
--          会議が無いのか、組織・space が違うのかは言わない）。
--          null を返さないのは、PostgREST が「select … from 関数(…)」の形で呼ぶため、null が全列 null の1行
--          （中身の無いオブジェクト）として届き、呼んだ側が成功と取り違えるから。
--        引数のどれかが null なら、何もせず null を返す（strict。p_content が null で本文が null に消えないように。
--          MCP は null を渡さない）。
--      呼ぶのは MCP サーバー（packages/mcp-server/src/tools/minutes.ts の minutesAppend。この名前・引数名で既に呼んでいる）。
--        MCP は service_role のキーでつなぐ。例外のとき（関数が無いときも）は読んでから書くに戻り、そこでも 0 行なので
--        「議事録の追記に失敗しました」になる（コードの変更は要らない）。
--      SECURITY INVOKER: 呼んだ役割の権限で書く。実行できるのは service_role だけ（PUBLIC・anon・authenticated には付けない）。
--        service_role には RLS が効かないので、組織と space で絞る条件がそのまま境界になる。space への書き込み権は、
--        呼ぶ前に MCP が checkAuth で確かめる。
--
-- ロック: 先頭で meetings を access exclusive で押さえてから、トリガーを付け替える（途中で強いロックに上げない）。
--   待つのは 3 秒まで。取れなければ全体を取り消すので、流し直す。
--   DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。本番の適用は1トランザクションなので、
--   ロックは最後まで持つ）。
-- 冪等: create or replace function・drop trigger if exists → create・revoke / grant。2回流しても同じ。
-- 可逆: 各節の末尾のロールバック節。適用しても行の中身は変えない。
--   戻らないもの: 適用後の update で進んだ updated_at（戻す必要は無い）。
--   戻したときの影響: トリガーを外すと、Web の保存が MCP の書き込みを見逃す（Web の議事録編集を出した後は外さない）。
--     関数を外すと、MCP は読んでから書くに戻る（同時に足すと片方が消えうる。コードの変更は要らない）。
-- =============================================================================


-- =============================================================================
-- 節 1: ロック
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.meetings in access exclusive mode;
end $$;

-- ロールバック（節 1）: なし（ロックはトランザクションの終わりで外れる）
-- =============================================================================
-- 節 2: update のたびに updated_at を now() にするトリガー
-- =============================================================================

create or replace function public.meetings_set_updated_at()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.meetings_set_updated_at() is
  'meetings のトリガー: update のたびに updated_at を now() にする（Web の議事録の保存で、別の場所の更新に気づくため）';

-- トリガー専用。直接は実行させない（トリガーとしての実行には実行権は要らない）
revoke all on function public.meetings_set_updated_at() from public, anon, authenticated, service_role;

drop trigger if exists trg_meetings_set_updated_at on public.meetings;
create trigger trg_meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.meetings_set_updated_at();

-- ロールバック（節 2。トリガーと関数を外す。行の中身は変えない。本番では節 1 と同じく先に meetings のロックを取って流す）:
--   drop trigger if exists trg_meetings_set_updated_at on public.meetings;
--   drop function if exists public.meetings_set_updated_at();
-- =============================================================================
-- 節 3: 議事録の末尾に1文で足す関数（MCP の minutes_append が呼ぶ）
-- =============================================================================

create or replace function public.rpc_minutes_append(
  p_meeting_id uuid,
  p_org_id     uuid,
  p_space_id   uuid,
  p_content    text
)
  returns public.meetings
  language plpgsql
  volatile
  strict
  security invoker
  set search_path = public
as $$
declare
  v_row public.meetings;
begin
  update public.meetings
     set minutes_md = case
                        when coalesce(minutes_md, '') = '' then p_content
                        else minutes_md || E'\n\n' || p_content
                      end
   where id = p_meeting_id
     and org_id = p_org_id
     and space_id = p_space_id
  returning * into v_row;

  -- 合う行が無ければ例外（会議が無いのか、組織・space が違うのかは言わない）
  if not found then
    raise exception 'minutes append target not found';
  end if;

  return v_row;
end;
$$;

comment on function public.rpc_minutes_append(uuid, uuid, uuid, text) is
  '議事録の末尾に1文の update で足す（空なら区切りなし・それ以外は空行を挟む）。会議・組織・space が合わなければ例外（minutes append target not found）。service_role（MCP）専用';

-- 実行できるのは service_role だけ
revoke all on function public.rpc_minutes_append(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_minutes_append(uuid, uuid, uuid, text) to service_role;

-- ロールバック（節 3。関数を外す。MCP は読んでから書くに戻る）:
--   drop function if exists public.rpc_minutes_append(uuid, uuid, uuid, text);
-- =============================================================================
-- 節 4: 末尾の確認（何も変えない）… トリガーが有効で、関数の形と実行権が想定どおり。違えば止める。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
  v_fn   regprocedure := to_regprocedure('public.rpc_minutes_append(uuid, uuid, uuid, text)');
begin
  -- トリガー: 有効（O）。update の前に、行ごとに meetings_set_updated_at() を呼ぶ
  select format('%s:%s:%s', t.tgenabled::text,
                (t.tgfoid = to_regprocedure('public.meetings_set_updated_at()'))::text,
                (pg_get_triggerdef(t.oid) like '%BEFORE UPDATE ON public.meetings FOR EACH ROW%')::text)
    into v_text
    from pg_trigger t
   where t.tgrelid = 'public.meetings'::regclass
     and t.tgname = 'trg_meetings_set_updated_at'
     and not t.tgisinternal;
  if v_text is distinct from 'O:true:true' then
    v_bad := v_bad || ' トリガー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- トリガーの関数: SECURITY INVOKER・search_path = public
  select format('definer=%s config=%s', p.prosecdef::text, coalesce(array_to_string(p.proconfig, ';'), ''))
    into v_text
    from pg_proc p
   where p.oid = to_regprocedure('public.meetings_set_updated_at()');
  if v_text is distinct from 'definer=false config=search_path=public' then
    v_bad := v_bad || ' トリガーの関数: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- トリガーの関数は直接は実行できない（PUBLIC・anon・authenticated・service_role に実行権が無い）
  select string_agg(r, ',') into v_text
    from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r
   where has_function_privilege(r, 'public.meetings_set_updated_at()', 'execute');
  if v_text is not null then
    v_bad := v_bad || ' トリガーの関数を実行できる役割: ' || v_text || ';';
  end if;

  if v_fn is null then
    v_bad := v_bad || ' rpc_minutes_append: (なし);';
  else
    -- rpc_minutes_append: meetings の行を1件返す・plpgsql・SECURITY INVOKER・strict・search_path = public
    select format('returns_meetings=%s setof=%s lang=%s definer=%s strict=%s config=%s',
                  (p.prorettype = 'public.meetings'::regtype)::text, p.proretset::text,
                  (select l.lanname from pg_language l where l.oid = p.prolang), p.prosecdef::text,
                  p.proisstrict::text, coalesce(array_to_string(p.proconfig, ';'), ''))
      into v_text
      from pg_proc p
     where p.oid = v_fn;
    if v_text is distinct from
       'returns_meetings=true setof=false lang=plpgsql definer=false strict=true config=search_path=public' then
      v_bad := v_bad || ' rpc_minutes_append: ' || coalesce(v_text, '(なし)') || ';';
    end if;

    -- 実行できるのは service_role だけ（PUBLIC・anon・authenticated は実行できない）
    if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute') then
      v_bad := v_bad || ' rpc_minutes_append の実行権: '
               || coalesce((select p.proacl::text from pg_proc p where p.oid = v_fn), '(null)') || ';';
    end if;
  end if;

  if v_bad <> '' then
    raise exception 'meeting minutes editing: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 4）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash scripts/verify-migrations-from-scratch.sh（rpc_minutes_append は SECURITY INVOKER なので、
--      anon が実行できる SECURITY DEFINER の許容リストとは関係しない）。
--   1) 適用後（本番）: 節 4 が通る。
--        select has_function_privilege('anon', 'public.rpc_minutes_append(uuid, uuid, uuid, text)', 'execute'),
--               has_function_privilege('authenticated', 'public.rpc_minutes_append(uuid, uuid, uuid, text)', 'execute'),
--               has_function_privilege('service_role', 'public.rpc_minutes_append(uuid, uuid, uuid, text)', 'execute');
--          → f / f / t
--        select tgname, tgenabled from pg_trigger
--         where tgrelid = 'public.meetings'::regclass and tgname = 'trg_meetings_set_updated_at';
--          → 1 行・O
--        合う会議が無いときは例外（何も変わらない。存在しない会議 id で試す）:
--        select public.rpc_minutes_append(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x');
--          → ERROR: minutes append target not found
--   2) 動作（本番）: MCP の minutes_append で追記すると、本文の末尾に空行を挟んで足され、updated_at が進む。
--      MCP の minutes_update で書き換えても updated_at が進む（Web で開いたままの議事録を保存すると「別の場所で更新されました」）。
-- =============================================================================
