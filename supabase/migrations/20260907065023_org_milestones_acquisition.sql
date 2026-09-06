-- =============================================================================
-- 会員登録後の「節目（マイルストーン）」と「流入経路」の記録 — 運営の分析用
--
-- 目的:
--   /admin/analytics に「登録した組織がどこまで進んだか（ファネル）」を出し、
--   「どの流入経路から来た組織が定着・有料化しているか」を見られるようにする。
--
-- 方針（設計正本: docs/spec/ADMIN_FUNNEL_ANALYTICS.md）:
--   1. 節目は org 単位で1行ずつ（org_id, milestone を主キー）。到達時刻は「その出来事の元データの時刻」。
--   2. 書き手は主に SQL の照合関数 reconcile_org_milestones()。既存テーブル
--      （organizations / spaces / tasks / invites / org_memberships / channel_* / org_billing ...）
--      から「最初の◯◯」を導出し、無い行だけ足す（冪等・ON CONFLICT DO NOTHING）。
--      → 既存の組織にも遡って効く。アプリの導線には手を入れない。
--   3. 元データに時刻が残らない節目（ポータルのプレビュー閲覧）だけ、アプリから
--      rpc_record_org_milestone() で直接記録する（ホワイトリスト方式）。
--   4. 流入経路は org_acquisition に1行。組織作成時に作成者（オーナー）が
--      rpc_record_org_acquisition() で自動記録（first-touch cookie 由来）。運営が
--      /admin/organizations/[id] から手で上書きできる（channel_source='manual'）。
--   5. 読み取りは service role のみ（RLS 有効・policy なし）。運営画面は admin client で読む。
--
-- 適用: アプリ稼働中の本番共用DBに適用可（新規テーブル・新規関数・cron登録・遡及backfillのみ）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) org_milestones: 節目の到達記録
-- -----------------------------------------------------------------------------
create table if not exists public.org_milestones (
  org_id uuid not null references public.organizations(id) on delete cascade,
  milestone text not null check (milestone in (
    'org_created',          -- 組織を作成
    'project_created',      -- 最初のプロジェクトを作成（初期設定完了）
    'first_task',           -- 最初のタスク（サンプル以外）
    'tasks_10',             -- タスクが10件に到達
    'team_invited',         -- チームメンバーを招待（招待 or 2人目の参加）
    'client_invited',       -- 相手先を招待
    'anyone_invited',       -- 誰かを招待（上2つの早い方）
    'task_published',       -- タスクを相手先に公開
    'portal_previewed',     -- 相手先の画面をプレビュー（アプリから記録）
    'line_requested',       -- 共通LINEの利用を申込
    'line_granted',         -- 共通LINEを開通（運営が承認）
    'line_linked',          -- LINE秘書と本人が連携
    'chat_group_connected', -- チャットのグループを接続（LINE/Slack/Chatwork/Google Chat）
    'ai_configured',        -- AI連携を設定
    'first_ai_task',        -- AIが会話から最初のタスクを拾った
    'tool_connected',       -- ツール連携（Google Tasks / Notion など）
    'api_key_created',      -- APIキーを発行（CLI/API 利用）
    'retained_7d',          -- 作成から7日以上たった後もタスクを触っている
    'retained_30d',         -- 作成から30日以上たった後もタスクを触っている
    'quote_requested',      -- 見積もりを依頼
    'paid',                 -- 有料プランに移行
    'canceled'              -- 解約
  )),
  reached_at timestamptz not null,
  user_id uuid,
  source text not null default 'reconcile' check (source in ('reconcile', 'app')),
  metadata jsonb,
  recorded_at timestamptz not null default now(),
  primary key (org_id, milestone)
);

comment on table public.org_milestones is
  '組織ごとの「節目」到達記録（運営の分析用）。reconcile_org_milestones() が既存データから導出して埋める。service role のみ。';
comment on column public.org_milestones.reached_at is '節目に到達した時刻（元データの時刻。集計時刻ではない）';
comment on column public.org_milestones.source is 'reconcile=照合関数が導出 / app=アプリが直接記録';

create index if not exists idx_org_milestones_milestone_reached
  on public.org_milestones (milestone, reached_at);

alter table public.org_milestones enable row level security;
-- policy は置かない（service role のみ）。Supabase は新規テーブルに anon/authenticated の権限を既定で配るので、
-- 将来ポリシーを足しても中身が見えないよう明示的に剥奪する（channel_user_links 等と同じ型）
revoke all on table public.org_milestones from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) org_acquisition: 流入経路（組織1行）
-- -----------------------------------------------------------------------------
create table if not exists public.org_acquisition (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  channel text not null default 'unknown' check (channel in (
    'task6_article',  -- 記事（TASK6）
    'shindan',        -- タスク滞留診断
    'organic_search', -- 検索
    'ai_search',      -- AI検索（ChatGPT / Perplexity など）
    'paid_ad',        -- 広告
    'sns',            -- SNS
    'referral',       -- 紹介・他サイトからのリンク
    'email',          -- メール
    'sales',          -- 営業・直接の紹介（運営が手で登録）
    'event',          -- セミナー・イベント（運営が手で登録）
    'direct',         -- 直接（URL 直打ち・ブックマーク等）
    'other',          -- その他（運営が手で登録）
    'unknown'         -- 不明（記録なし）
  )),
  channel_source text not null default 'auto' check (channel_source in ('auto', 'manual')),
  ref text,
  article_slug text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  click_id text,
  landing_path text,
  referrer text,
  first_touch_at timestamptz,
  note text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.org_acquisition is
  '組織の流入経路。作成時に自動記録（first-touch cookie 由来）、運営が手で上書き可。service role のみ。';
comment on column public.org_acquisition.channel_source is 'auto=自動判定 / manual=運営が手で登録（自動判定で上書きしない）';

create index if not exists idx_org_acquisition_channel on public.org_acquisition (channel);

alter table public.org_acquisition enable row level security;
-- policy は置かない（service role のみ）。上と同じく明示的に剥奪する
revoke all on table public.org_acquisition from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) reconcile_org_milestones: 既存データから節目を導出して埋める（冪等）
--    p_org_id を渡すとその組織だけ、null なら全組織。戻り値は追加した行数。
-- -----------------------------------------------------------------------------
create or replace function public.reconcile_org_milestones(p_org_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  v_n integer;
begin
  -- 同時に2本走らせない（毎時 cron と運営画面の手動起動が重なると tasks を二重に舐める）。
  -- 取れなければ「今は別の照合が動いている」ので何もせず 0 を返す
  if p_org_id is null and not pg_try_advisory_xact_lock(hashtext('reconcile_org_milestones')) then
    return 0;
  end if;

  -- 組織を作成
  insert into org_milestones (org_id, milestone, reached_at)
  select o.id, 'org_created', o.created_at
  from organizations o
  where (p_org_id is null or o.id = p_org_id)
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 最初のプロジェクト（初期設定完了）
  insert into org_milestones (org_id, milestone, reached_at)
  select s.org_id, 'project_created', min(s.created_at)
  from spaces s
  where s.type = 'project' and (p_org_id is null or s.org_id = p_org_id)
  group by s.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 最初のタスク（サンプル以外）
  insert into org_milestones (org_id, milestone, reached_at)
  select t.org_id, 'first_task', min(t.created_at)
  from tasks t
  where t.is_sample = false and (p_org_id is null or t.org_id = p_org_id)
  group by t.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- タスク10件到達（10件目の作成時刻）
  insert into org_milestones (org_id, milestone, reached_at)
  select x.org_id, 'tasks_10', x.created_at
  from (
    select t.org_id, t.created_at,
           row_number() over (partition by t.org_id order by t.created_at, t.id) as rn
    from tasks t
    where t.is_sample = false and (p_org_id is null or t.org_id = p_org_id)
  ) x
  where x.rn = 10
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- チームメンバーを招待（member 宛の招待 or 2人目の内部メンバー参加、の早い方）
  insert into org_milestones (org_id, milestone, reached_at)
  select x.org_id, 'team_invited', min(x.ts)
  from (
    select i.org_id, i.created_at as ts
    from invites i
    where i.role = 'member' and (p_org_id is null or i.org_id = p_org_id)
    union all
    select m.org_id, m.created_at
    from (
      select om.org_id, om.created_at,
             row_number() over (partition by om.org_id order by om.created_at, om.id) as rn
      from org_memberships om
      where om.role in ('owner', 'member') and (p_org_id is null or om.org_id = p_org_id)
    ) m
    where m.rn = 2
  ) x
  group by x.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 相手先を招待（client 宛の招待 or client の参加、の早い方）
  insert into org_milestones (org_id, milestone, reached_at)
  select x.org_id, 'client_invited', min(x.ts)
  from (
    select i.org_id, i.created_at as ts
    from invites i
    where i.role = 'client' and (p_org_id is null or i.org_id = p_org_id)
    union all
    select om.org_id, om.created_at
    from org_memberships om
    where om.role = 'client' and (p_org_id is null or om.org_id = p_org_id)
  ) x
  group by x.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 誰かを招待（上2つの早い方）
  insert into org_milestones (org_id, milestone, reached_at)
  select m.org_id, 'anyone_invited', min(m.reached_at)
  from org_milestones m
  where m.milestone in ('team_invited', 'client_invited')
    and (p_org_id is null or m.org_id = p_org_id)
  group by m.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- タスクを相手先に公開。
  --   client_scope の DB 既定は 'deliverable'（画面以外＝RPC/連携/AI 経由の登録は明示しない限り公開側）なので、
  --   「公開タスクがある」だけでは「相手先に見せた」にならない。相手先を招待済み（client_invited）の組織に限り、
  --   「最初の公開タスク」と「相手先の招待」の遅い方を到達時刻とする（公開操作の時刻は残らないため近似）。
  insert into org_milestones (org_id, milestone, reached_at)
  select t.org_id, 'task_published', greatest(min(t.created_at), ci.reached_at)
  from tasks t
  join org_milestones ci on ci.org_id = t.org_id and ci.milestone = 'client_invited'
  where t.client_scope = 'deliverable' and t.is_sample = false
    and (p_org_id is null or t.org_id = p_org_id)
  group by t.org_id, ci.reached_at
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 共通LINEの申込 / 開通
  insert into org_milestones (org_id, milestone, reached_at)
  select p.org_id, 'line_requested', p.shared_bot_access_requested_at
  from org_channel_policy p
  where p.shared_bot_access_requested_at is not null
    and (p_org_id is null or p.org_id = p_org_id)
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  insert into org_milestones (org_id, milestone, reached_at)
  select p.org_id, 'line_granted', p.shared_bot_access_granted_at
  from org_channel_policy p
  where p.shared_bot_access_granted_at is not null
    and (p_org_id is null or p.org_id = p_org_id)
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- LINE秘書と本人が連携
  insert into org_milestones (org_id, milestone, reached_at)
  select l.org_id, 'line_linked', min(l.linked_at)
  from channel_user_links l
  where (p_org_id is null or l.org_id = p_org_id)
  group by l.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- チャットのグループを接続
  insert into org_milestones (org_id, milestone, reached_at)
  select g.org_id, 'chat_group_connected', min(g.joined_at)
  from channel_groups g
  where (p_org_id is null or g.org_id = p_org_id)
  group by g.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- AI連携を設定
  insert into org_milestones (org_id, milestone, reached_at)
  -- 設定時刻が無い行は「集計時刻」を到達時刻にしてしまうと永久に固定されるので、次回に回す
  select c.org_id, 'ai_configured', coalesce(c.created_at, c.updated_at)
  from org_ai_config c
  where coalesce(c.created_at, c.updated_at) is not null
    and (p_org_id is null or c.org_id = p_org_id)
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- AIが会話から最初のタスクを拾った
  insert into org_milestones (org_id, milestone, reached_at)
  select d.org_id, 'first_ai_task', min(d.created_at)
  from channel_digest_tasks d
  where (p_org_id is null or d.org_id = p_org_id)
  group by d.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- ツール連携
  insert into org_milestones (org_id, milestone, reached_at)
  select c.org_id, 'tool_connected', min(c.created_at)
  from integration_connections c
  where (p_org_id is null or c.org_id = p_org_id)
  group by c.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- APIキー発行
  insert into org_milestones (org_id, milestone, reached_at)
  select k.org_id, 'api_key_created', min(k.created_at)
  from api_keys k
  where (p_org_id is null or k.org_id = p_org_id)
  group by k.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 7日後 / 30日後も利用（組織作成から N 日以上たった後の、人によるタスク操作の最初）
  --   活動の元データは「タスクの作成時刻」と「監査ログ（audit_logs）のタスク操作」。
  --   tasks.updated_at は上書きされる（最後の更新しか残らない）ため使わない。
  --   audit_logs は追記のみなので、遡っても最初の活動時刻が正しく取れる。
  insert into org_milestones (org_id, milestone, reached_at)
  select a.org_id, 'retained_7d', min(a.ts)
  from (
    select t.org_id, t.created_at as ts from tasks t where t.is_sample = false
    union all
    select l.org_id, l.occurred_at from audit_logs l
    where l.event_type like 'task.%' and l.actor_id is not null
  ) a
  join organizations o on o.id = a.org_id
  where a.ts >= o.created_at + interval '7 days'
    and (p_org_id is null or a.org_id = p_org_id)
  group by a.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  insert into org_milestones (org_id, milestone, reached_at)
  select a.org_id, 'retained_30d', min(a.ts)
  from (
    select t.org_id, t.created_at as ts from tasks t where t.is_sample = false
    union all
    select l.org_id, l.occurred_at from audit_logs l
    where l.event_type like 'task.%' and l.actor_id is not null
  ) a
  join organizations o on o.id = a.org_id
  where a.ts >= o.created_at + interval '30 days'
    and (p_org_id is null or a.org_id = p_org_id)
  group by a.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 見積もり依頼
  insert into org_milestones (org_id, milestone, reached_at)
  select q.org_id, 'quote_requested', min(q.requested_at)
  from billing_quotes q
  where (p_org_id is null or q.org_id = p_org_id)
  group by q.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 有料化（free 以外で有効/お試し中 の課金行、または見積もり承認の早い方。
  --        課金行の切替時刻は残らないため updated_at で近似。初回観測が残る）
  insert into org_milestones (org_id, milestone, reached_at)
  select x.org_id, 'paid', min(x.ts)
  from (
    select b.org_id, b.updated_at as ts
    from org_billing b
    where b.plan_id <> 'free' and b.status in ('active', 'trialing')
      and (p_org_id is null or b.org_id = p_org_id)
    union all
    select q.org_id, q.approved_at
    from billing_quotes q
    where q.approved_at is not null and (p_org_id is null or q.org_id = p_org_id)
  ) x
  group by x.org_id
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 解約
  insert into org_milestones (org_id, milestone, reached_at)
  select b.org_id, 'canceled', b.updated_at
  from org_billing b
  where b.status = 'canceled' and (p_org_id is null or b.org_id = p_org_id)
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end;
$$;

comment on function public.reconcile_org_milestones(uuid) is
  '既存データから組織の節目を導出して org_milestones に足す（冪等）。cron が毎時、運営画面が手動で呼ぶ。';

-- 照合が毎時 tasks / audit_logs を読むので、絞り込みに使う列へ部分索引を置く
create index if not exists idx_tasks_org_created_nonsample
  on public.tasks (org_id, created_at, id) where is_sample = false;
create index if not exists idx_tasks_org_deliverable_nonsample
  on public.tasks (org_id, created_at) where is_sample = false and client_scope = 'deliverable';
create index if not exists idx_audit_logs_org_task_activity
  on public.audit_logs (org_id, occurred_at) where event_type like 'task.%' and actor_id is not null;

revoke execute on function public.reconcile_org_milestones(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_org_milestones(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4) rpc_record_org_milestone: アプリからの直接記録（ホワイトリスト方式）
--    元データに時刻が残らない節目だけ。呼び出し元は組織の内部メンバー（owner/member）。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_record_org_milestone(p_org_id uuid, p_milestone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_milestone not in ('portal_previewed') then
    raise exception 'milestone not recordable from app: %', p_milestone using errcode = '22023';
  end if;
  if not exists (
    select 1 from org_memberships om
    where om.org_id = p_org_id and om.user_id = auth.uid() and om.role in ('owner', 'member')
  ) then
    raise exception 'not a member of the organization' using errcode = '42501';
  end if;

  insert into org_milestones (org_id, milestone, reached_at, user_id, source)
  values (p_org_id, p_milestone, now(), auth.uid(), 'app')
  on conflict do nothing;
end;
$$;

revoke execute on function public.rpc_record_org_milestone(uuid, text) from public, anon;
grant execute on function public.rpc_record_org_milestone(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5) rpc_record_org_acquisition: 組織作成時の流入経路の自動記録
--    呼び出し元は組織のオーナー。既に行があれば何もしない（first-touch を守る・手動を潰さない）。
--    p_data が空でも、メール登録時の user metadata（signup_ref / signup_art）から補完する。
--    channel の判定はブラウザ側（src/lib/acquisition/firstTouch.ts）で行い、ここでは許可リスト照合だけ。
--    利用者が自分の組織の流入経路を偽ることは可能だが、影響は自組織の分析値だけで他テナントに及ばない。
--    判定ロジックを SQL に二重実装しない（テストのある1本に寄せる）ことを優先した。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_record_org_acquisition(p_org_id uuid, p_data jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_channel text;
  v_ref text;
  v_art text;
  v_meta jsonb;
  v_first_touch timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from org_memberships om
    where om.org_id = p_org_id and om.user_id = v_uid and om.role = 'owner'
  ) then
    raise exception 'not an owner of the organization' using errcode = '42501';
  end if;

  -- p_data は「JSON オブジェクト」だけ受け付ける（配列・文字列などは無視して cookie 無し扱い）
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    p_data := '{}'::jsonb;
  end if;

  v_channel := nullif(left(coalesce(p_data->>'channel', ''), 40), '');
  -- ref / 記事 slug は既知の値・形式だけ通す（cookie の値はクライアントが書き換えられる前提）
  v_ref := case when p_data->>'ref' in ('task6', 'shindan') then p_data->>'ref' else null end;
  v_art := case when (p_data->>'article_slug') ~ '^[a-z0-9-]{1,64}$' then p_data->>'article_slug' else null end;

  -- cookie に何も無かった場合、メール登録時に保存した metadata から補完
  if v_channel is null or v_channel = 'direct' then
    select u.raw_user_meta_data into v_meta from auth.users u where u.id = v_uid;
    if v_meta ? 'signup_ref' then
      v_ref := coalesce(v_ref, case when v_meta->>'signup_ref' in ('task6', 'shindan') then v_meta->>'signup_ref' end);
      v_art := coalesce(v_art, case when (v_meta->>'signup_art') ~ '^[a-z0-9-]{1,64}$' then v_meta->>'signup_art' end);
      v_channel := case v_meta->>'signup_ref'
        when 'task6' then 'task6_article'
        when 'shindan' then 'shindan'
        else v_channel end;
    end if;
  end if;

  -- 自動記録で使える channel だけ（sales / event / unknown は運営の手動登録専用）
  if v_channel is null or v_channel not in (
    'task6_article','shindan','organic_search','ai_search','paid_ad','sns','referral',
    'email','direct','other'
  ) then
    v_channel := 'direct';
  end if;

  -- first_touch_at: 壊れた文字列は無視。未来や1年以上前の値も信用しない（cookie の寿命は90日）
  begin
    v_first_touch := (p_data->>'first_touch_at')::timestamptz;
  exception when others then
    v_first_touch := null;
  end;
  if v_first_touch is not null
     and (v_first_touch > now() + interval '1 day' or v_first_touch < now() - interval '1 year') then
    v_first_touch := null;
  end if;

  insert into org_acquisition (
    org_id, channel, channel_source, ref, article_slug,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id,
    landing_path, referrer, first_touch_at, updated_by
  ) values (
    p_org_id, v_channel, 'auto', v_ref, v_art,
    nullif(left(coalesce(p_data->>'utm_source', ''), 200), ''),
    nullif(left(coalesce(p_data->>'utm_medium', ''), 200), ''),
    nullif(left(coalesce(p_data->>'utm_campaign', ''), 200), ''),
    nullif(left(coalesce(p_data->>'utm_content', ''), 200), ''),
    nullif(left(coalesce(p_data->>'utm_term', ''), 200), ''),
    nullif(left(coalesce(p_data->>'click_id', ''), 40), ''),
    nullif(left(coalesce(p_data->>'landing_path', ''), 300), ''),
    nullif(left(coalesce(p_data->>'referrer', ''), 300), ''),
    v_first_touch,
    v_uid
  )
  on conflict (org_id) do nothing;
end;
$$;

revoke execute on function public.rpc_record_org_acquisition(uuid, jsonb) from public, anon;
grant execute on function public.rpc_record_org_acquisition(uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6) admin_org_milestone_stats: 運営画面向けの集計（コホート＝期間内に作成された組織）
--    引数:
--      p_since  … コホートの開始（null なら全期間）
--      p_funnel … メインファネルの段（節目キーの配列・順序あり）。画面側の FUNNEL_STEPS を渡す
--    戻り値:
--      channel が null の行 … 全体（median_days あり）
--      channel が ある 行 … 流入経路別（件数のみ）
--      milestone='_cohort' の行 … 分母（コホートの組織数）。全体・経路別の両方で出す
--      milestone='_funnel:<key>' の行（channel null）… ファネルの累積到達
--        ＝「その段までの全ての段に到達した組織数」。節目は独立（招待せず有料化もある）なので、
--          独立の到達数を前段で割っても転換率にならない。真の段間転換率はこの累積で出す
-- -----------------------------------------------------------------------------
create or replace function public.admin_org_milestone_stats(
  p_since timestamptz default null,
  p_funnel text[] default '{}'::text[]
)
returns table (
  channel text,
  milestone text,
  org_count bigint,
  reached_count bigint,
  median_days numeric
)
language sql
security definer
set search_path = public
stable
as $$
  with cohort as (
    select o.id, o.created_at, coalesce(a.channel, 'unknown') as channel
    from organizations o
    left join org_acquisition a on a.org_id = o.id
    where p_since is null or o.created_at >= p_since
  ),
  cohort_by_channel as (
    select c.channel, count(*)::bigint as cnt from cohort c group by c.channel
  ),
  reached as (
    select c.channel, m.milestone, c.id as org_id,
           extract(epoch from (m.reached_at - c.created_at)) / 86400.0 as days
    from cohort c
    join org_milestones m on m.org_id = c.id
  ),
  funnel_steps as (
    select i as step_no, p_funnel[i] as key, p_funnel[1:i] as prefix
    from generate_subscripts(p_funnel, 1) as i
  ),
  funnel_cumulative as (
    select f.key, f.step_no,
           (select count(*)::bigint from cohort c
            where (select count(*) from org_milestones m
                   where m.org_id = c.id and m.milestone = any(f.prefix)) = array_length(f.prefix, 1)
           ) as cnt
    from funnel_steps f
  )
  select null::text, '_cohort'::text, count(*)::bigint, count(*)::bigint, null::numeric from cohort
  union all
  select null::text, r.milestone, (select count(*)::bigint from cohort), count(*)::bigint,
         round((percentile_cont(0.5) within group (order by r.days))::numeric, 1)
  from reached r
  group by r.milestone
  union all
  select null::text, '_funnel:' || fc.key, (select count(*)::bigint from cohort), fc.cnt, null::numeric
  from funnel_cumulative fc
  union all
  select cc.channel, '_cohort'::text, cc.cnt, cc.cnt, null::numeric from cohort_by_channel cc
  union all
  select r.channel, r.milestone, cc.cnt, count(*)::bigint, null::numeric
  from reached r
  join cohort_by_channel cc on cc.channel = r.channel
  group by r.channel, r.milestone, cc.cnt
$$;

revoke execute on function public.admin_org_milestone_stats(timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.admin_org_milestone_stats(timestamptz, text[]) to service_role;

-- -----------------------------------------------------------------------------
-- 7) 遡及 backfill
--    - 既存の全組織の節目を導出
--    - 既存組織の流入経路をオーナーの登録時 metadata（signup_ref）から補完。無ければ unknown
-- -----------------------------------------------------------------------------
select public.reconcile_org_milestones();

insert into public.org_acquisition (org_id, channel, channel_source, ref, article_slug)
select
  o.id,
  case u.raw_user_meta_data->>'signup_ref'
    when 'task6' then 'task6_article'
    when 'shindan' then 'shindan'
    else 'unknown' end,
  'auto',
  nullif(left(coalesce(u.raw_user_meta_data->>'signup_ref', ''), 40), ''),
  nullif(left(coalesce(u.raw_user_meta_data->>'signup_art', ''), 64), '')
from public.organizations o
left join lateral (
  select om.user_id
  from public.org_memberships om
  where om.org_id = o.id and om.role = 'owner'
  order by om.created_at, om.id
  limit 1
) owner_m on true
left join auth.users u on u.id = owner_m.user_id
on conflict (org_id) do nothing;

-- -----------------------------------------------------------------------------
-- 8) cron: 毎時 7 分に照合（SQL 関数の直接呼び出し。vault シークレット不要）
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'org-milestones-reconcile') then
      perform cron.schedule('org-milestones-reconcile', '7 * * * *', 'select public.reconcile_org_milestones()');
    end if;
  end if;
end $$;

-- =============================================================================
-- ロールバック:
--   select cron.unschedule('org-milestones-reconcile');
--   drop function if exists public.admin_org_milestone_stats(timestamptz, text[]);
--   drop index if exists public.idx_tasks_org_created_nonsample;
--   drop index if exists public.idx_tasks_org_deliverable_nonsample;
--   drop index if exists public.idx_audit_logs_org_task_activity;
--   drop function if exists public.rpc_record_org_acquisition(uuid, jsonb);
--   drop function if exists public.rpc_record_org_milestone(uuid, text);
--   drop function if exists public.reconcile_org_milestones(uuid);
--   drop table if exists public.org_acquisition;
--   drop table if exists public.org_milestones;
-- =============================================================================
