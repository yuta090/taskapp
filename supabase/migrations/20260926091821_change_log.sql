-- =============================================================================
-- データの変更の控え（change_log）: 誰が・いつ・どの行を・どう変えたかを1行ずつ残す（追記だけ）
--
-- 背景: ブラウザから Wiki のページが消され（RLS を通した物理削除）、誰が消したか分からなかった。
--   不具合の調査と事後の確認のため、主な表の追加・更新・削除をすべて控える。
--   ブラウザ（ログイン中の利用者の権限）からの変更は、この migration だけで auth.uid() の人に結び付く。
--   サーバーの鍵（service_role）からの変更は、サーバーが付ける見出し（x-agentpm-*）で人と経路を記す（見出しを付ける側は別PR）。
--
-- 節:
--   1) ロック（対象の表を先に押さえる。トリガーを付ける migration の決まり）
--   2) 表 change_log（RLS 有効・許可のポリシー無し = authenticated / anon は1行も見えない）
--   3) change_log_redact: 秘密の列（jsonb の中のキーも、どの深さでも）を伏せ、大きい本文は長さと md5 に縮める
--   4) change_log_capture: トリガー関数（誰が・どの経路かを決めて1行書く）
--   5) change_log_attach: 表にトリガーを付ける
--   6) 対象の表に付ける（明示の一覧だけ。載っていない表は控えない）
--   7) 秘密の列の伏せ忘れの点検（漏れがあれば migration を止める）
--   8) 運営者だけが引ける検索 rpc_change_log_search
--
-- 記録の失敗の扱い: 設定値（request.jwt.claims / request.headers）の読み取りは、壊れていても例外にしない（null 扱い）。
--   一方、change_log への書き込み自体が失敗したら、元の変更も失敗させる（控えを黙って落とさない。追記だけの控えの約束）。
--
-- 冪等: create table / index は if not exists、関数は create or replace、ポリシーは有無を見てから作る。
--   トリガーは change_log_attach が付け直す。何度流しても同じ形になる。
--
-- 当て方: 対象の表を share row exclusive でロックする（読むのは止めない。書き込みは適用の間だけ待たせる）。
--   人の少ない時間に流す。ロック待ちの 3 秒を超えて止まったら、何も変わっていないので、そのまま流し直せばよい。
--
-- 分かっている限界:
--   - 未ログイン（anon）の書き込みは system / system として残る（利用者を示す sub が無いため）。
--   - 表ごとの全削除（truncate）は控えない（行ごとのトリガーは truncate では動かない）。
--   - 表の持ち主（postgres）は権限に関係なく change_log を更新・削除できる。追記だけを守るのは、利用者の役割と
--     サーバーの鍵（service_role）に書き込みの権限を付けないことによる。
--
-- 保持: 当面は消さない。表が 1GB を超えたら、pg_cron で 400 日より古い行を消す仕組みを検討する。
--
-- 不可逆な点: なし（控えの表と関数を足し、トリガーを付けるだけ。既存の行は変えない）。
--   ただしロールバックで表を消すと、それまでの控えは戻らない。
-- ロールバックは末尾の「ロールバック」節。
-- =============================================================================


-- =============================================================================
-- 節 1: ロック（ある表だけ。share row exclusive = 読むのは止めない。待つのは 3 秒まで）
-- =============================================================================

do $$
declare
  v_name text;
  v_rel regclass;
begin
  set local lock_timeout = '3s';
  foreach v_name in array array[
    'tasks', 'task_owners', 'task_relations', 'task_pricing', 'task_internal_metrics', 'task_publications',
    'task_comments', 'milestones', 'milestone_publications', 'meetings', 'meeting_participants', 'meeting_drafts',
    'meeting_transcripts', 'wiki_pages', 'wiki_page_publications', 'reviews', 'review_approvals', 'files',
    'discussion_items', 'discussion_comments', 'scheduling_proposals', 'proposal_slots', 'proposal_respondents',
    'slot_responses', 'spaces', 'space_memberships', 'space_groups', 'space_agency_settings', 'space_github_repos',
    'space_slack_channels', 'org_memberships', 'organizations', 'org_billing', 'org_email_templates', 'org_ai_config',
    'org_channel_policy', 'invites', 'profiles', 'api_keys', 'integration_connections', 'integration_sinks',
    'channel_groups', 'channel_group_claims', 'channel_identities', 'channel_accounts', 'channel_event_subscriptions',
    'github_installations', 'github_repositories', 'task_github_links', 'task_github_issue_links', 'billing_documents',
    'billing_document_tasks', 'billing_quotes', 'accounting_partner_links', 'announcements', 'notification_email_prefs',
    'email_templates', 'blog_posts', 'cta_blocks', 'slack_workspaces'
  ]
  loop
    v_rel := to_regclass('public.' || quote_ident(v_name));
    if v_rel is not null then
      execute format('lock table %s in share row exclusive mode', v_rel);
    end if;
  end loop;
end $$;

-- ロールバック（節 1）: なし（ロックはトランザクションの終わりで外れる）


-- =============================================================================
-- 節 2: 表 change_log
-- =============================================================================

create table if not exists public.change_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- 同じトランザクションの変更（削除の連鎖など）をまとめて引くための番号
  txid bigint not null,
  table_name text not null,
  op char(1) not null check (op in ('I', 'U', 'D')),
  row_pk jsonb not null,
  -- 行に org_id / space_id があれば写す。控えは元の行より長く残すので外部キーは付けない
  org_id uuid,
  space_id uuid,
  actor_kind text not null check (actor_kind in ('user', 'api_key', 'service', 'system')),
  actor_user_id uuid,
  api_key_id uuid,
  -- 'app'|'cli'|'mcp'|'stdio'|'portal'|'cron'|'webhook'|'connector'|'admin'|'system'|'unattributed'
  channel text not null,
  request_id text,
  changed_columns text[],
  old_row jsonb,
  new_row jsonb
);

create index if not exists change_log_table_row_idx on public.change_log (table_name, row_pk);
create index if not exists change_log_org_occurred_idx on public.change_log (org_id, occurred_at desc);
create index if not exists change_log_actor_occurred_idx on public.change_log (actor_user_id, occurred_at desc);
create index if not exists change_log_txid_idx on public.change_log (txid);
-- 行ごとの検索（rpc_change_log_search の p_table + p_row_id）用。新しい順にそのまま読める
create index if not exists change_log_table_row_id_idx on public.change_log (table_name, (row_pk ->> 'id'), id desc);

alter table public.change_log enable row level security;

-- 許可のポリシーは作らない（authenticated / anon からは1行も見えない・書けない）。
-- 二要素認証の RESTRICTIVE ポリシーは全 RLS 表の決まり（20260910235546_mfa_policy_org_email_templates.sql と同じ形）
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'change_log' and policyname = 'mfa_required_when_enrolled'
  ) then
    create policy mfa_required_when_enrolled on public.change_log
      as restrictive for all to authenticated
      using ((select public.mfa_satisfied()))
      with check ((select public.mfa_satisfied()));
  end if;
end $$;

-- 権限: 利用者の役割には何も付けない。サーバーの鍵（service_role）は読むだけ（運営画面から引く用）。
--   行はトリガー（持ち主 postgres の権限）だけが書く。誰にも update / delete を付けない
revoke all on table public.change_log from public, anon, authenticated, service_role;
grant select on table public.change_log to service_role;
revoke all on sequence public.change_log_id_seq from public, anon, authenticated, service_role;

-- ロールバック（節 2）: drop table if exists public.change_log;（控えは戻らない）


-- =============================================================================
-- 節 3: change_log_redact（秘密の列を伏せる・大きい本文を縮める）
--   (a) 名前が秘密らしい形 → "[redacted]"。列名だけでなく、jsonb の中のキーにも、どの深さでも当てる
--       （連携の metadata / import_config は、秘密を入れ子のキーに持つ。例: metadata の *_secret_encrypted、
--        import_config の kintone_app_tokens）
--   (b) 表ごとの明示の一覧（列名の形では拾えない物）→ "[redacted]"
--   (c) 大きい本文 → 追加・更新では {"len": 文字数, "md5": …}。削除では全文を残す（消えた中身を戻せるように）
-- =============================================================================

create or replace function public.change_log_is_secret_key(p_key text)
  returns boolean
  language sql
  immutable
  set search_path = pg_catalog, public
as $$
  select p_key ~* '(tokens?|secret|hash|password|credentials?|private_key|cipher|nonce|otp|code|encrypted|webhook_url)$|^(access|refresh)_'
$$;

revoke all on function public.change_log_is_secret_key(text) from public, anon, authenticated;

-- jsonb の値を、どの深さでも (a) で伏せる（オブジェクトのキーを見る。配列は要素ごとに潜る）
create or replace function public.change_log_redact_value(p_val jsonb)
  returns jsonb
  language plpgsql
  immutable
  set search_path = pg_catalog, public
as $$
declare
  v_out jsonb;
  v_key text;
  v_val jsonb;
begin
  if p_val is null then
    return null;
  end if;

  case jsonb_typeof(p_val)
    when 'object' then
      v_out := '{}'::jsonb;
      for v_key, v_val in select key, value from jsonb_each(p_val)
      loop
        if v_val <> 'null'::jsonb and public.change_log_is_secret_key(v_key) then
          v_out := v_out || jsonb_build_object(v_key, '[redacted]');
        else
          v_out := v_out || jsonb_build_object(v_key, public.change_log_redact_value(v_val));
        end if;
      end loop;
      return v_out;
    when 'array' then
      return coalesce(
        (select jsonb_agg(public.change_log_redact_value(e.value) order by e.ord)
           from jsonb_array_elements(p_val) with ordinality as e(value, ord)),
        '[]'::jsonb);
    else
      return p_val;
  end case;
end;
$$;

revoke all on function public.change_log_redact_value(jsonb) from public, anon, authenticated;

create or replace function public.change_log_redact(p_table text, p_row jsonb, p_op char)
  returns jsonb
  language plpgsql
  immutable
  set search_path = pg_catalog, public
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_new jsonb;
  v_text text;
begin
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return public.change_log_redact_value(p_row);
  end if;

  for v_key, v_val in select key, value from jsonb_each(p_row)
  loop
    if v_val = 'null'::jsonb then
      v_new := v_val;

    -- (a) 列名の形 / (b) 表ごとの明示の一覧
    elsif public.change_log_is_secret_key(v_key) or (p_table, v_key) in (
      ('api_keys', 'key_hash'),
      ('channel_accounts', 'credentials_encrypted'),
      ('integration_connections', 'access_token'),
      ('integration_connections', 'access_token_encrypted'),
      ('integration_connections', 'refresh_token'),
      ('integration_connections', 'refresh_token_encrypted'),
      ('integration_sinks', 'secret_encrypted'),
      ('invites', 'token'),
      ('org_ai_config', 'api_key_encrypted'),
      ('slack_workspaces', 'bot_token_encrypted')
    ) then
      v_new := '"[redacted]"'::jsonb;

    -- (c) 大きい本文（元の値の長さと md5）
    elsif p_op in ('I', 'U') and (p_table, v_key) in (
      ('wiki_pages', 'body'),
      ('meetings', 'minutes_md'),
      ('meetings', 'summary_body'),
      ('meeting_transcripts', 'raw_text'),
      ('meeting_transcripts', 'normalized_text'),
      ('meeting_drafts', 'draft_json'),
      ('blog_posts', 'body_md')
    ) then
      v_text := case when jsonb_typeof(v_val) = 'string' then v_val #>> '{}' else v_val::text end;
      v_new := jsonb_build_object('len', length(v_text), 'md5', md5(v_text));

    else
      v_new := public.change_log_redact_value(v_val);
      -- webhook の送り先 URL（integration_sinks.config の url）は、それ自体が合言葉を含むことがある
      if p_table = 'integration_sinks' and v_key = 'config' and jsonb_typeof(v_new) = 'object' and v_new ? 'url' then
        v_new := jsonb_set(v_new, '{url}', '"[redacted]"'::jsonb);
      end if;
    end if;

    v_out := v_out || jsonb_build_object(v_key, v_new);
  end loop;

  return v_out;
end;
$$;

revoke all on function public.change_log_redact(text, jsonb, char) from public, anon, authenticated;

-- ロールバック（節 3）: drop function if exists public.change_log_redact(text, jsonb, char);
--   drop function if exists public.change_log_redact_value(jsonb); drop function if exists public.change_log_is_secret_key(text);


-- =============================================================================
-- 節 4: change_log_capture（トリガー関数）
--   引数（TG_ARGV）= その表の主キーの列名
--   誰が:
--     1) ログイン中の利用者（auth.uid() と同じ読み方で sub が取れる）→ user / app。見出しは読まない
--     2) サーバーの鍵（request.jwt.claims の role = service_role）→ 見出し x-agentpm-* から
--        actor-id があれば user（api-key-id もあれば api_key）、無ければ service。経路が一覧外・無しなら unattributed
--     3) それ以外（pg_cron・migration・直接の接続など）→ system / system
--   設定値の読み取りは pg_input_is_valid で確かめてから変換し、壊れていても例外にしない。
--   updated_at と、表ごとの定期更新の列（最終利用日時など）しか変わらない更新は控えない。
-- =============================================================================

create or replace function public.change_log_capture()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_op char(1);
  v_changed text[];
  v_keep text[];
  v_noise text[];
  v_pk jsonb := '{}'::jsonb;
  v_i int;
  v_org uuid;
  v_space uuid;
  v_setting text;
  v_claims jsonb;
  v_headers jsonb;
  v_sub text;
  v_uid uuid;
  v_actor_kind text;
  v_actor uuid;
  v_api_key uuid;
  v_channel text;
  v_request_id text;
begin
  v_op := case tg_op when 'INSERT' then 'I' when 'UPDATE' then 'U' else 'D' end;
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  -- 更新: 変わった列を出す。updated_at と定期更新の列だけなら控えない
  if v_op = 'U' then
    select coalesce(array_agg(k order by k), '{}')
      into v_changed
      from (select jsonb_object_keys(v_new) as k) s
     where (v_old -> k) is distinct from (v_new -> k);

    v_noise := case tg_table_name
      when 'api_keys' then array['last_used_at']
      when 'channel_group_claims' then array['events_seen', 'last_event_at']
      when 'channel_groups' then array['last_extracted_message_created_at']
      when 'integration_connections' then array['last_import_success_at', 'last_poll_attempt_at', 'poll_cursor']
      when 'integration_sinks' then array['last_delivered_at', 'consecutive_failures']
      when 'notification_email_prefs' then array['last_digest_sent_at']
      when 'channel_event_subscriptions' then array['expire_time', 'last_renew_error']
      else array[]::text[]
    end || array['updated_at'];

    -- Google Tasks のポーリング（src/lib/google-tasks/poll.ts）は metadata の直下の poll_cursor だけを進める。
    --   metadata の違いが poll_cursor だけなら、metadata も定期更新として扱う
    if tg_table_name = 'integration_connections'
       and 'metadata' = any (v_changed)
       and (v_old -> 'metadata') - 'poll_cursor' is not distinct from (v_new -> 'metadata') - 'poll_cursor' then
      v_noise := v_noise || array['metadata'];
    end if;

    if v_changed <@ v_noise then
      return null;
    end if;
  end if;

  -- 主キー
  for v_i in 0 .. tg_nargs - 1 loop
    v_pk := v_pk || jsonb_build_object(tg_argv[v_i], v_row -> tg_argv[v_i]);
  end loop;

  -- 組織と space（行にあれば。organizations / spaces は自分の id）
  v_setting := case when tg_table_name = 'organizations' then v_row ->> 'id' else v_row ->> 'org_id' end;
  if v_setting is not null and pg_input_is_valid(v_setting, 'uuid') then v_org := v_setting::uuid; end if;
  v_setting := case when tg_table_name = 'spaces' then v_row ->> 'id' else v_row ->> 'space_id' end;
  if v_setting is not null and pg_input_is_valid(v_setting, 'uuid') then v_space := v_setting::uuid; end if;

  -- 誰が・どの経路か
  v_setting := nullif(current_setting('request.jwt.claims', true), '');
  if v_setting is not null and pg_input_is_valid(v_setting, 'jsonb') then
    v_claims := v_setting::jsonb;
    if jsonb_typeof(v_claims) <> 'object' then v_claims := null; end if;
  end if;

  -- auth.uid() と同じ読み方（request.jwt.claim.sub が先・無ければ request.jwt.claims の sub）
  v_sub := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_claims ->> 'sub');
  if v_sub is not null and pg_input_is_valid(v_sub, 'uuid') then v_uid := v_sub::uuid; end if;

  if v_uid is not null then
    v_actor_kind := 'user';
    v_actor := v_uid;
    v_channel := 'app';
  elsif v_claims ->> 'role' = 'service_role' then
    v_setting := nullif(current_setting('request.headers', true), '');
    if v_setting is not null and pg_input_is_valid(v_setting, 'jsonb') then
      v_headers := v_setting::jsonb;
      if jsonb_typeof(v_headers) <> 'object' then v_headers := null; end if;
    end if;

    v_setting := v_headers ->> 'x-agentpm-actor-id';
    if v_setting is not null and pg_input_is_valid(v_setting, 'uuid') then v_actor := v_setting::uuid; end if;
    v_setting := v_headers ->> 'x-agentpm-api-key-id';
    if v_setting is not null and pg_input_is_valid(v_setting, 'uuid') then v_api_key := v_setting::uuid; end if;

    v_actor_kind := case
      when v_actor is not null and v_api_key is not null then 'api_key'
      when v_actor is not null then 'user'
      else 'service'
    end;

    v_channel := v_headers ->> 'x-agentpm-channel';
    if v_channel is null or v_channel not in
       ('app', 'cli', 'mcp', 'stdio', 'portal', 'cron', 'webhook', 'connector', 'admin', 'system') then
      v_channel := 'unattributed';
    end if;
    v_request_id := left(v_headers ->> 'x-agentpm-request-id', 200);
  else
    v_actor_kind := 'system';
    v_channel := 'system';
  end if;

  -- 残す中身: 追加 = 新しい行 / 削除 = 消えた行（本文は全文）/ 更新 = 主キー・org_id・space_id・変わった列だけ
  if v_op = 'U' then
    v_keep := v_changed || array['org_id', 'space_id'];
    for v_i in 0 .. tg_nargs - 1 loop
      v_keep := v_keep || tg_argv[v_i];
    end loop;
    select jsonb_object_agg(key, value) into v_old from jsonb_each(v_old) where key = any (v_keep);
    select jsonb_object_agg(key, value) into v_new from jsonb_each(v_new) where key = any (v_keep);
  end if;

  insert into public.change_log (
    txid, table_name, op, row_pk, org_id, space_id,
    actor_kind, actor_user_id, api_key_id, channel, request_id,
    changed_columns, old_row, new_row
  ) values (
    pg_current_xact_id()::text::bigint, tg_table_name, v_op, v_pk, v_org, v_space,
    v_actor_kind, v_actor, v_api_key, v_channel, v_request_id,
    v_changed,
    public.change_log_redact(tg_table_name, v_old, v_op),
    public.change_log_redact(tg_table_name, v_new, v_op)
  );

  return null;
end;
$$;

alter function public.change_log_capture() owner to postgres;
revoke all on function public.change_log_capture() from public, anon, authenticated;

-- ロールバック（節 4）: 節 6 のトリガーを外してから drop function if exists public.change_log_capture();


-- =============================================================================
-- 節 5: change_log_attach（表に控えのトリガーを付ける・付け直す）
-- =============================================================================

create or replace function public.change_log_attach(p_table regclass)
  returns void
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_args text;
begin
  select string_agg(quote_literal(a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum))
    into v_args
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = p_table and i.indisprimary;

  if v_args is null then
    raise exception 'change_log_attach: % に主キーがありません', p_table;
  end if;

  execute format(
    'create or replace trigger change_log_capture after insert or update or delete on %s for each row execute function public.change_log_capture(%s)',
    p_table, v_args
  );
end;
$$;

revoke all on function public.change_log_attach(regclass) from public, anon, authenticated;

-- ロールバック（節 5）: drop function if exists public.change_log_attach(regclass);


-- =============================================================================
-- 節 6: 対象の表に付ける（明示の一覧だけ）
--   付けない表: 控え・履歴そのもの（audit_logs, task_events, wiki_page_versions, cli_usage_logs, api_key_usage,
--   auth_event_logs, github_webhook_events など）、件数が多く頻繁に変わる表（notifications, push_subscriptions など）、
--   使い捨ての合言葉の表（email_action_tokens, mcp_confirm_tokens, oauth_* など）。
--   一覧の表は 2026-09-26 に空の DB からの再構築と本番の両方で存在と主キーを確かめた（60 表すべてあり）。
--   無い表は飛ばす（通知だけ出して止めない）。
-- =============================================================================

do $$
declare
  v_name text;
  v_rel regclass;
begin
  foreach v_name in array array[
    'tasks', 'task_owners', 'task_relations', 'task_pricing', 'task_internal_metrics', 'task_publications',
    'task_comments', 'milestones', 'milestone_publications', 'meetings', 'meeting_participants', 'meeting_drafts',
    'meeting_transcripts', 'wiki_pages', 'wiki_page_publications', 'reviews', 'review_approvals', 'files',
    'discussion_items', 'discussion_comments', 'scheduling_proposals', 'proposal_slots', 'proposal_respondents',
    'slot_responses', 'spaces', 'space_memberships', 'space_groups', 'space_agency_settings', 'space_github_repos',
    'space_slack_channels', 'org_memberships', 'organizations', 'org_billing', 'org_email_templates', 'org_ai_config',
    'org_channel_policy', 'invites', 'profiles', 'api_keys', 'integration_connections', 'integration_sinks',
    'channel_groups', 'channel_group_claims', 'channel_identities', 'channel_accounts', 'channel_event_subscriptions',
    'github_installations', 'github_repositories', 'task_github_links', 'task_github_issue_links', 'billing_documents',
    'billing_document_tasks', 'billing_quotes', 'accounting_partner_links', 'announcements', 'notification_email_prefs',
    'email_templates', 'blog_posts', 'cta_blocks', 'slack_workspaces'
  ]
  loop
    v_rel := to_regclass('public.' || quote_ident(v_name));
    if v_rel is null then
      raise notice 'change_log: % がないので飛ばします', v_name;
    else
      perform public.change_log_attach(v_rel);
    end if;
  end loop;
end $$;

-- ロールバック（節 6）: 末尾のロールバック節のループでトリガーを外す


-- =============================================================================
-- 節 7: 秘密の列の伏せ忘れの点検
--   秘密を持つ表で、列名が秘密らしい文字列の列（文字列・json・バイト列）が、change_log_redact で伏せられることを確かめる。
--   ここで見るのは表の列（一番上の階層）だけ。jsonb の中のキーは、change_log_redact_value がどの深さでも
--   名前の形で伏せる（下で連携の metadata / import_config の形を1つずつ確かめる）。
--   伏せられない列があれば migration を止める（列を足したら、change_log_redact の一覧も直す）。
--   秘密ではないと確かめた列だけを除外する（表示用の先頭数文字・外部の識別子・状態）。
-- =============================================================================

do $$
declare
  r record;
  v_missing text[] := '{}';
  v_got jsonb;
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name in ('api_keys', 'integration_connections', 'github_installations', 'slack_workspaces',
                            'org_ai_config', 'integration_sinks', 'channel_accounts', 'invites')
       and c.column_name ~* '(key|token|secret|hash|password|passwd|credential|webhook|signing|private|cipher|nonce|otp|encrypt|salt)'
       and c.data_type in ('text', 'character varying', 'character', 'jsonb', 'json', 'bytea')
       and (c.table_name, c.column_name) not in (
         ('api_keys', 'key_prefix'),
         ('integration_connections', 'external_account_key'),
         ('org_ai_config', 'key_status')
       )
  loop
    v_got := public.change_log_redact(r.table_name, jsonb_build_object(r.column_name, 'x'), 'D');
    if v_got -> r.column_name is distinct from '"[redacted]"'::jsonb then
      v_missing := v_missing || (r.table_name || '.' || r.column_name);
    end if;
  end loop;

  -- webhook の送り先 URL
  v_got := public.change_log_redact('integration_sinks', '{"config": {"url": "x", "sheet_name": "s"}}'::jsonb, 'D');
  if v_got #>> '{config,url}' is distinct from '[redacted]' or v_got #>> '{config,sheet_name}' is distinct from 's' then
    v_missing := v_missing || 'integration_sinks.config.url'::text;
  end if;

  -- 入れ子のキー（multica・受信口の metadata、kintone の import_config）
  v_got := public.change_log_redact('integration_connections',
    '{"metadata": {"multica": {"base_url": "u", "send_secret_encrypted": "x", "receive_secret_encrypted": "x"},
                   "generic_inbound": {"receive_secret_encrypted": "x"}},
      "import_config": {"kintone_app_tokens": {"1": "x"}, "target_space_id": "s"}}'::jsonb, 'D');
  if v_got::text like '%"x"%' or v_got #>> '{metadata,multica,base_url}' is distinct from 'u'
     or v_got #>> '{import_config,target_space_id}' is distinct from 's' then
    v_missing := v_missing || 'integration_connections.metadata/import_config (nested)'::text;
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'change_log: 伏せられない秘密らしい列があります: %', array_to_string(v_missing, ', ');
  end if;
end $$;


-- =============================================================================
-- 節 8: rpc_change_log_search（運営者だけが引ける）
-- =============================================================================

create or replace function public.rpc_change_log_search(
  p_org_id uuid default null,
  p_table text default null,
  p_row_id text default null,
  p_actor uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 100
)
  returns setof public.change_log
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.rpc_is_superadmin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 与えられた条件だけで問い合わせを組む（行ごとの検索が change_log_table_row_id_idx をそのまま使えるように）。
  -- 値はすべて using で渡す
  return query execute
    'select c.* from public.change_log c where true'
    || case when p_org_id is not null then ' and c.org_id = $1' else '' end
    || case when p_table is not null then ' and c.table_name = $2' else '' end
    || case when p_row_id is not null then ' and (c.row_pk ->> ''id'') = $3' else '' end
    || case when p_actor is not null then ' and c.actor_user_id = $4' else '' end
    || case when p_from is not null then ' and c.occurred_at >= $5' else '' end
    || case when p_to is not null then ' and c.occurred_at < $6' else '' end
    || ' order by c.id desc limit $7'
    using p_org_id, p_table, p_row_id, p_actor, p_from, p_to, least(greatest(coalesce(p_limit, 100), 1), 1000);
end;
$$;

revoke all on function public.rpc_change_log_search(uuid, text, text, uuid, timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.rpc_change_log_search(uuid, text, text, uuid, timestamptz, timestamptz, int)
  to authenticated;

-- ロールバック（節 8）: drop function if exists public.rpc_change_log_search(uuid, text, text, uuid, timestamptz, timestamptz, int);


-- =============================================================================
-- ロールバック（全体。上から順に流す。控えの表を消すと、それまでの控えは戻らない）
-- =============================================================================
-- do $$
-- declare r record;
-- begin
--   for r in select tgrelid::regclass as rel from pg_trigger where tgname = 'change_log_capture' and not tgisinternal
--   loop
--     execute format('drop trigger if exists change_log_capture on %s', r.rel);
--   end loop;
-- end $$;
-- drop function if exists public.rpc_change_log_search(uuid, text, text, uuid, timestamptz, timestamptz, int);
-- drop function if exists public.change_log_attach(regclass);
-- drop function if exists public.change_log_capture();
-- drop function if exists public.change_log_redact(text, jsonb, char);
-- drop function if exists public.change_log_redact_value(jsonb);
-- drop function if exists public.change_log_is_secret_key(text);
-- drop table if exists public.change_log;
