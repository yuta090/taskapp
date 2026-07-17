-- rpc_consume_user_link_code の受け入れ条件（Stage 2.7-A §3-7）。
-- 前提: user_link_code_test.sql（下地）→ 本物の migration → 本ファイル の順で流す。
-- 失敗は raise exception で落とす。最後まで到達すれば全項目 PASS。

set client_min_messages = notice;

\set ORG_A   '00000000-0000-4000-8000-000000000001'
\set USER1   '00000000-0000-4000-8000-0000000000a1'
\set USER2   '00000000-0000-4000-8000-0000000000a2'
\set ACCT_A  '00000000-0000-4000-8000-0000000000c1'
\set ACCT_B  '00000000-0000-4000-8000-0000000000c2'

-- テスト間の独立性のため毎回きれいにする
truncate table public.channel_user_links,
               public.channel_user_link_codes,
               public.channel_user_link_attempts restart identity cascade;

do $$
declare
  v_org      uuid := '00000000-0000-4000-8000-000000000001';
  v_user1    uuid := '00000000-0000-4000-8000-0000000000a1';
  v_user2    uuid := '00000000-0000-4000-8000-0000000000a2';
  v_acct_a   uuid := '00000000-0000-4000-8000-0000000000c1';
  v_acct_b   uuid := '00000000-0000-4000-8000-0000000000c2';
  v_line_u1  text := 'Uline0000000000000000000000000001';
  v_line_u2  text := 'Uline0000000000000000000000000002';
  v_hash     text;
  v_status   text;
  v_link     uuid;
  v_used     timestamptz;
  v_cnt      int;
begin
  ---------------------------------------------------------------------------
  -- 1) 正常系: 有効なコード → ok。リンク作成・コード消費・試行(成功)記録
  ---------------------------------------------------------------------------
  v_hash := encode(digest('code-ok', 'sha256'), 'hex');
  insert into public.channel_user_link_codes (org_id, user_id, channel_account_id, code_hash)
  values (v_org, v_user1, v_acct_a, v_hash);

  select status, link_id into v_status, v_link
  from public.rpc_consume_user_link_code(v_hash, v_acct_a, v_line_u1);

  if v_status <> 'ok' then raise exception '1) 正常系が ok でない: %', v_status; end if;
  if v_link is null then raise exception '1) link_id が返らない'; end if;

  if not exists (select 1 from public.channel_user_links
                 where id = v_link and user_id = v_user1 and external_user_id = v_line_u1
                   and revoked_at is null and linked_via = 'code') then
    raise exception '1) リンク行が正しく作られていない';
  end if;

  select used_at into v_used from public.channel_user_link_codes where code_hash = v_hash;
  if v_used is null then raise exception '1) コードが消費されていない'; end if;

  if not exists (select 1 from public.channel_user_link_attempts
                 where external_user_id = v_line_u1 and succeeded) then
    raise exception '1) 成功の試行履歴が残っていない';
  end if;
  raise notice 'PASS 1) 正常系';

  ---------------------------------------------------------------------------
  -- 2) 未知のコード → invalid（例外を投げない）。失敗履歴が残る
  ---------------------------------------------------------------------------
  select status into v_status
  from public.rpc_consume_user_link_code(encode(digest('nope', 'sha256'), 'hex'), v_acct_a, v_line_u2);
  if v_status <> 'invalid' then raise exception '2) 未知コードが invalid でない: %', v_status; end if;

  if not exists (select 1 from public.channel_user_link_attempts
                 where external_user_id = v_line_u2 and not succeeded) then
    raise exception '2) 失敗の試行履歴が残っていない（例外でロールバックされた疑い）';
  end if;
  raise notice 'PASS 2) 未知コード → invalid・履歴が残る';

  ---------------------------------------------------------------------------
  -- 3) 使用済みコードの再利用 → invalid
  ---------------------------------------------------------------------------
  select status into v_status
  from public.rpc_consume_user_link_code(v_hash, v_acct_a, v_line_u2);
  if v_status <> 'invalid' then raise exception '3) 使用済みコードが invalid でない: %', v_status; end if;
  raise notice 'PASS 3) 使用済みコード → invalid';

  ---------------------------------------------------------------------------
  -- 4) 期限切れコード → expired
  ---------------------------------------------------------------------------
  v_hash := encode(digest('code-expired', 'sha256'), 'hex');
  insert into public.channel_user_link_codes (org_id, user_id, channel_account_id, code_hash, expires_at)
  values (v_org, v_user2, v_acct_a, v_hash, now() - interval '1 minute');

  select status into v_status
  from public.rpc_consume_user_link_code(v_hash, v_acct_a, v_line_u2);
  if v_status <> 'expired' then raise exception '4) 期限切れが expired でない: %', v_status; end if;
  raise notice 'PASS 4) 期限切れ → expired';

  ---------------------------------------------------------------------------
  -- 5) 他OA（別org）へ送られたコード → invalid（コードは消費されない）
  ---------------------------------------------------------------------------
  v_hash := encode(digest('code-otheracct', 'sha256'), 'hex');
  insert into public.channel_user_link_codes (org_id, user_id, channel_account_id, code_hash)
  values (v_org, v_user2, v_acct_a, v_hash);

  select status into v_status
  from public.rpc_consume_user_link_code(v_hash, v_acct_b, v_line_u2);  -- 別OAへ提示
  if v_status <> 'invalid' then raise exception '5) 他OAのコードが invalid でない: %', v_status; end if;

  select used_at into v_used from public.channel_user_link_codes where code_hash = v_hash;
  if v_used is not null then raise exception '5) 他OA提示でコードが消費されてしまった'; end if;
  raise notice 'PASS 5) 他OA → invalid・コードは温存';

  ---------------------------------------------------------------------------
  -- 6) conflict: 同じLINE userId を別ユーザーに紐付けようとした
  --    → conflict。コードは消費されない（セーブポイントで巻き戻る）。履歴は残る
  ---------------------------------------------------------------------------
  v_hash := encode(digest('code-conflict', 'sha256'), 'hex');
  insert into public.channel_user_link_codes (org_id, user_id, channel_account_id, code_hash)
  values (v_org, v_user2, v_acct_a, v_hash);  -- user2 が、既に user1 に紐付いた LINE を主張

  select status into v_status
  from public.rpc_consume_user_link_code(v_hash, v_acct_a, v_line_u1);
  if v_status <> 'conflict' then raise exception '6) conflict が返らない: %', v_status; end if;

  select used_at into v_used from public.channel_user_link_codes where code_hash = v_hash;
  if v_used is not null then raise exception '6) conflict なのにコードが消費された（巻き戻っていない）'; end if;

  if not exists (select 1 from public.channel_user_link_attempts
                 where external_user_id = v_line_u1 and not succeeded) then
    raise exception '6) conflict の試行履歴が残っていない（セーブポイントで巻き戻された疑い）';
  end if;
  raise notice 'PASS 6) conflict → コード温存・履歴は残る';

  ---------------------------------------------------------------------------
  -- 7) 試行制限: 直近10分に5回失敗 → locked。ロック中は履歴を増やさない（窓を延長しない）
  ---------------------------------------------------------------------------
  delete from public.channel_user_link_attempts;
  insert into public.channel_user_link_attempts (channel_account_id, external_user_id, succeeded, attempted_at)
  select v_acct_a, v_line_u2, false, now() - (interval '1 minute' * g) from generate_series(1, 5) g;

  select count(*) into v_cnt from public.channel_user_link_attempts where external_user_id = v_line_u2;

  select status into v_status
  from public.rpc_consume_user_link_code(encode(digest('whatever', 'sha256'), 'hex'), v_acct_a, v_line_u2);
  if v_status <> 'locked' then raise exception '7) 5回失敗後に locked でない: %', v_status; end if;

  if (select count(*) from public.channel_user_link_attempts where external_user_id = v_line_u2) <> v_cnt then
    raise exception '7) ロック中に試行行が追加された（窓が延長され永久ロックになる）';
  end if;
  raise notice 'PASS 7) 5回失敗 → locked・窓を延長しない';

  ---------------------------------------------------------------------------
  -- 8) 古い失敗（10分より前）はロックに数えない → 自然解除
  ---------------------------------------------------------------------------
  delete from public.channel_user_link_attempts;
  insert into public.channel_user_link_attempts (channel_account_id, external_user_id, succeeded, attempted_at)
  select v_acct_a, v_line_u2, false, now() - interval '11 minutes' from generate_series(1, 5);

  select status into v_status
  from public.rpc_consume_user_link_code(encode(digest('whatever2', 'sha256'), 'hex'), v_acct_a, v_line_u2);
  if v_status = 'locked' then raise exception '8) 10分より前の失敗でロックされている（自然解除しない）'; end if;
  raise notice 'PASS 8) 古い失敗は数えない（自然解除）';

  raise notice '=== 全項目 PASS ===';
end $$;

-- 9) 権限: anon / authenticated は3テーブルに触れない
do $$
declare r record; v_bad text := '';
begin
  for r in
    select t.tablename, g.grantee, g.privilege_type
    from pg_tables t
    join information_schema.role_table_grants g
      on g.table_name = t.tablename and g.table_schema = t.schemaname
    where t.schemaname = 'public'
      and t.tablename in ('channel_user_links','channel_user_link_codes','channel_user_link_attempts')
      and g.grantee in ('anon','authenticated')
  loop
    v_bad := v_bad || format('%s→%s(%s) ', r.tablename, r.grantee, r.privilege_type);
  end loop;

  if v_bad <> '' then
    raise exception '9) anon/authenticated に権限が残っている: %', v_bad;
  end if;
  raise notice 'PASS 9) anon/authenticated は3テーブルに触れない';
end $$;
