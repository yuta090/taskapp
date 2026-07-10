-- =============================================================================
-- AI秘書チャネル配管 Stage 1 (docs/spec/AI_SECRETARY_DESIGN_v0.1.md §8)
--
-- 背骨 = channel_messages（全チャネル会話ログ・真実の源）。
-- 未着/受領/証跡/催促判断/週次報告は全てこの表の投影になる。
--
-- 設計判断（fable-architect 敵対レビュー反映済み）:
--   - channel_accounts: 白ラベル＝事務所ごとにLINE公式アカウントを持つため
--     最初からマルチテナント。資格情報は pgp_sym_encrypt(SYSTEM_ENCRYPTION_KEY)。
--   - channel_identities: 同一人物が複数顧問先の窓口になり得るため
--     unique は (org, channel, external_id, space) × status='active' の partial。
--     DELETE禁止（revokeのみ）— 過去ログの帰属を壊さない。
--   - channel_messages: 実質 append-only を BEFORE UPDATE トリガーで強制。
--     帰属(space_id/identity_id)は NULL→値 の一方向のみ。内容(body/payload)の
--     変更は redaction 遷移時のみ（マイナンバー等の中身破壊＋墓標）。
--   - link_code は期限内マルチユース（紙/QRを複数人が読むため）。
--   - RLS: 読取=内部メンバーのみ(app_is_org_internal)。書込=service roleのみ。
--     channel_accounts は資格情報のため authenticated へのポリシー無し。
-- =============================================================================

-- 複合FK (space_id, org_id) 用。spaces.id はPKなので一意性は自明だが、
-- 子テーブルの org_id が spaces の実所属と食い違って RLS 境界が破れるのを防ぐ。
create unique index if not exists spaces_id_org_unique on public.spaces(id, org_id);

-- -----------------------------------------------------------------------------
-- 1) channel_accounts — 事務所ごとのチャネル資格情報（LINE公式アカウント等）
-- -----------------------------------------------------------------------------
create table if not exists public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('line', 'email', 'chatwork', 'slack', 'google_chat')),
  -- LINE: webhook body の destination(=bot userId) からアカウントを逆引きする
  line_bot_user_id text,
  -- 白ラベル秘書の表示名（挨拶文面に使う。例: 「山田会計事務所の秘書」）
  display_name text not null,
  -- 暗号化JSON {"channel_secret": "...", "access_token": "..."}
  -- encrypt_system_secret(json, SYSTEM_ENCRYPTION_KEY) で作成
  credentials_encrypted text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channel_accounts_line_bot_unique
  on public.channel_accounts(channel, line_bot_user_id)
  where line_bot_user_id is not null;

create index if not exists channel_accounts_org on public.channel_accounts(org_id);

comment on table public.channel_accounts is 'チャネル資格情報（事務所ごとのLINE公式アカウント等）。service roleのみアクセス可';
comment on column public.channel_accounts.line_bot_user_id is 'LINE webhook destination 逆引き用の bot userId';

-- -----------------------------------------------------------------------------
-- 2) channel_identities — 顧問先の連絡先とチャネル外部IDの紐付け
-- -----------------------------------------------------------------------------
create table if not exists public.channel_identities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  space_id uuid not null,
  channel text not null check (channel in ('line', 'email', 'chatwork', 'slack', 'google_chat')),
  -- LINE userId / メールアドレス等
  external_id text not null,
  display_name text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  linked_via text not null default 'link_code' check (linked_via in ('link_code', 'manual')),
  link_code_id uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (space_id, org_id) references public.spaces(id, org_id) on delete restrict
);

-- 同一人物×同一顧問先の active 紐付けは1件。revoke後の再リンクは可。
-- 同一人物が複数顧問先の窓口になるケース（社長が2法人経営等）は space 違いで許容。
create unique index if not exists channel_identities_active_unique
  on public.channel_identities(org_id, channel, external_id, space_id)
  where status = 'active';

create index if not exists channel_identities_inbound_lookup
  on public.channel_identities(channel, external_id)
  where status = 'active';

create index if not exists channel_identities_org on public.channel_identities(org_id);
create index if not exists channel_identities_space on public.channel_identities(space_id);

-- DELETE禁止: 消すと過去ログ(channel_messages.identity_id)の帰属が壊れる。revokeで無効化する。
create or replace function public.channel_identities_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'channel_identities: DELETE is forbidden. Set status=revoked instead.';
end;
$$;

drop trigger if exists trg_channel_identities_no_delete on public.channel_identities;
create trigger trg_channel_identities_no_delete
  before delete on public.channel_identities
  for each row execute function public.channel_identities_no_delete();

comment on table public.channel_identities is '顧問先連絡先⇔チャネル外部ID(LINE userId等)の紐付け。DELETE禁止・revokeのみ';

-- -----------------------------------------------------------------------------
-- 3) channel_link_codes — 顧問先突合用コード（期限内マルチユース）
-- -----------------------------------------------------------------------------
create table if not exists public.channel_link_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  space_id uuid not null,
  channel text not null default 'line' check (channel in ('line', 'email', 'chatwork', 'slack', 'google_chat')),
  code text not null unique,
  -- 紙/QRを社長と経理の2人が読む運用があるため単回使用にしない。
  -- 使用ごとに channel_identities が1件でき、first_used_at は初回だけ記録。
  expires_at timestamptz not null default (now() + interval '30 days'),
  first_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (space_id, org_id) references public.spaces(id, org_id) on delete cascade
);

create index if not exists channel_link_codes_org on public.channel_link_codes(org_id);
create index if not exists channel_link_codes_space on public.channel_link_codes(space_id);

comment on table public.channel_link_codes is 'LINE友だち追加後の本人特定コード。期限内マルチユース';

alter table public.channel_identities
  add constraint channel_identities_link_code_fk
  foreign key (link_code_id) references public.channel_link_codes(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 4) channel_messages — 背骨のログ（実質 append-only）
-- -----------------------------------------------------------------------------
create table if not exists public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  -- 突合前の inbound は null。identity 成立時に NULL→値 の一方向でのみ埋まる
  space_id uuid,
  identity_id uuid references public.channel_identities(id) on delete restrict,
  account_id uuid references public.channel_accounts(id) on delete restrict,
  channel text not null check (channel in ('line', 'email', 'chatwork', 'slack', 'google_chat')),
  direction text not null check (direction in ('inbound', 'outbound')),
  actor text not null check (actor in ('client', 'secretary', 'staff', 'system')),
  -- 突合前でも「誰から来たか」の生ID(LINE userId等)は残す
  external_user_id text,
  -- dedupe用。LINEは message.id（webhook再送で変わらない）、follow等は webhookEventId
  external_message_id text,
  content_type text not null default 'text'
    check (content_type in ('text', 'image', 'file', 'video', 'audio', 'sticker', 'system')),
  body text,
  payload jsonb not null default '{}'::jsonb,
  -- 添付バイナリの Storage パス（LINE側は取得期限があるため受信時に保存する）
  storage_path text,
  status text not null default 'received'
    check (status in ('received', 'queued', 'sent', 'failed')),
  error text,
  -- WoZ期: 秘書名義で送った職員の userId（証跡）
  sent_by uuid,
  -- redaction（マイナンバー等の中身破壊＋墓標）。取り消し不可
  redacted_at timestamptz,
  redacted_by uuid,
  redacted_reason text,
  -- チャネル側のイベント時刻
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (space_id, org_id) references public.spaces(id, org_id) on delete restrict
);

-- webhook再送・push再試行での二重記録防止
create unique index if not exists channel_messages_dedupe
  on public.channel_messages(org_id, channel, external_message_id)
  where external_message_id is not null;

create index if not exists channel_messages_space_timeline
  on public.channel_messages(space_id, created_at desc);
create index if not exists channel_messages_org_timeline
  on public.channel_messages(org_id, created_at desc);
create index if not exists channel_messages_identity
  on public.channel_messages(identity_id);

comment on table public.channel_messages is '全チャネル会話ログ（真実の源）。append-onlyをトリガーで強制';

-- append-only ガード: 証跡の不変性を実装者の善意でなく制約にする
create or replace function public.channel_messages_guard_update()
returns trigger
language plpgsql
as $$
declare
  v_is_redaction boolean := (old.redacted_at is null and new.redacted_at is not null);
begin
  -- 不変列
  if new.org_id is distinct from old.org_id
     or new.channel is distinct from old.channel
     or new.direction is distinct from old.direction
     or new.actor is distinct from old.actor
     or new.external_user_id is distinct from old.external_user_id
     or new.external_message_id is distinct from old.external_message_id
     or new.account_id is distinct from old.account_id
     or new.sent_by is distinct from old.sent_by
     or new.occurred_at is distinct from old.occurred_at
     or new.created_at is distinct from old.created_at then
    raise exception 'channel_messages: immutable column cannot be changed';
  end if;

  -- 帰属は NULL→値 の一方向のみ（突合後のバックフィル用）
  if old.space_id is not null and new.space_id is distinct from old.space_id then
    raise exception 'channel_messages: space_id can only be set once';
  end if;
  if old.identity_id is not null and new.identity_id is distinct from old.identity_id then
    raise exception 'channel_messages: identity_id can only be set once';
  end if;

  -- 内容(body/payload)の変更は redaction 遷移時のみ
  if (new.body is distinct from old.body or new.payload is distinct from old.payload)
     and not v_is_redaction then
    raise exception 'channel_messages: content is immutable (use rpc_redact_channel_message)';
  end if;

  -- storage_path: 添付の後追い取得(NULL→値)は許可。差し替えは禁止。除去は redaction のみ
  if new.storage_path is distinct from old.storage_path
     and not (old.storage_path is null and new.storage_path is not null)
     and not v_is_redaction then
    raise exception 'channel_messages: storage_path can only be set once (or cleared via redaction)';
  end if;

  -- redaction の取り消し・改変禁止
  if old.redacted_at is not null
     and (new.redacted_at is distinct from old.redacted_at
          or new.redacted_by is distinct from old.redacted_by
          or new.redacted_reason is distinct from old.redacted_reason) then
    raise exception 'channel_messages: redaction is irreversible';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_channel_messages_guard on public.channel_messages;
create trigger trg_channel_messages_guard
  before update on public.channel_messages
  for each row execute function public.channel_messages_guard_update();

-- redaction RPC: 中身だけ破壊し「メッセージが存在した事実」は残す。
-- Storage の添付実体の削除は呼び出し側(app)が admin storage API で行う。
create or replace function public.rpc_redact_channel_message(
  p_message_id uuid,
  p_redacted_by uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update channel_messages
  set body = '[削除済み（機微情報）]',
      payload = '{}'::jsonb,
      storage_path = null,
      redacted_at = now(),
      redacted_by = p_redacted_by,
      redacted_reason = p_reason
  where id = p_message_id
    and redacted_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- service role のみ実行可（暗黙のPUBLIC grantをrevokeするため、明示grantが必須）
revoke execute on function public.rpc_redact_channel_message(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_redact_channel_message(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5) RLS
-- -----------------------------------------------------------------------------
alter table public.channel_accounts enable row level security;
alter table public.channel_identities enable row level security;
alter table public.channel_link_codes enable row level security;
alter table public.channel_messages enable row level security;

-- channel_accounts: 資格情報。authenticated/anon は一切アクセス不可（ポリシー無し＋revoke）
revoke all on table public.channel_accounts from anon, authenticated;

-- 残り3表: 読取は内部メンバーのみ。書込ポリシーは作らない（service role経由のみ）
revoke all on table public.channel_identities from anon, authenticated;
revoke all on table public.channel_link_codes from anon, authenticated;
revoke all on table public.channel_messages from anon, authenticated;
grant select on table public.channel_identities to authenticated;
grant select on table public.channel_link_codes to authenticated;
grant select on table public.channel_messages to authenticated;

drop policy if exists channel_identities_select_internal on public.channel_identities;
create policy channel_identities_select_internal
  on public.channel_identities
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

drop policy if exists channel_link_codes_select_internal on public.channel_link_codes;
create policy channel_link_codes_select_internal
  on public.channel_link_codes
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

drop policy if exists channel_messages_select_internal on public.channel_messages;
create policy channel_messages_select_internal
  on public.channel_messages
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

-- -----------------------------------------------------------------------------
-- 6) 添付用 Storage バケット（非公開・storage.objects へのポリシーは付与しない）
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('channel-attachments', 'channel-attachments', false, 52428800)
on conflict (id) do nothing;

-- =============================================================================
-- 検証（適用後に service role で実施）:
--   1) 他orgのauthenticatedユーザーで channel_messages/identities が 0行
--   2) channel_accounts が同orgのauthenticatedでも読めない
--   3) body の直接UPDATEが service role でも拒否され、rpc_redact_channel_message 経由のみ通る
--   4) space_id の NULL→値 は通り、値→別値 は拒否される
--   5) 同一 (org, channel, external_message_id) の二重INSERTが一意制約違反になる
--   6) channel_identities の DELETE が拒否される
-- ロールバック:
--   drop table channel_messages, channel_link_codes, channel_identities, channel_accounts cascade;
--   drop function channel_messages_guard_update, channel_identities_no_delete,
--     rpc_redact_channel_message; delete from storage.buckets where id='channel-attachments';
--   drop index spaces_id_org_unique;
-- =============================================================================
