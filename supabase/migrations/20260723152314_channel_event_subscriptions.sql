-- =============================================================================
-- Google Chat 本格実装 PR-a: 全メッセージ購読状態テーブル
-- (Fable 裁定 論点1: このPRはテーブル・RLS・型・store CRUD・platform共通account seed まで。
--  Pub/Sub 受信・cron・renew の実配線は後続 PR-b 以降。ランタイム経路は未接続)
--
-- 背景: Google Chat の "spaces/XXX"（グループトーク）から全メッセージを受け取るには
--   Google Workspace Events API の subscription を空間ごとに1つ張る必要がある。
--   その購読の生存状態（有効/失効/破損/削除・失効時刻・renewエラー）を1枚で持つ。
--
-- 設計判断（既存 channel_* 表の慣行を踏襲）:
--   - group_id は NOT NULL。limbo（未承認・未紐付け）グループには購読を作らない
--     （承認され channel_groups に active 行がある claimed group のみ購読対象）。
--   - 複合FK (group_id, org_id) → channel_groups(id, org_id) で org 境界を保護
--     （channel_messages.group_id 等と同型。account の付け替え等で org が食い違うのを防ぐ）。
--   - status の縮退: broken = 拾い（自動取り込み）は止まるが、既存の記録・digest・
--     完了ループは壊さない。expired = 失効（renew 失敗の恒久版）、deleted = 空間削除等で撤去済み。
--   - 書込は service role のみ（RLS バイパス）。authenticated には SELECT のみ許可し、
--     INSERT/UPDATE/DELETE policy は作らない = deny-by-default（policy 無し＝拒否）。
--   - updated_at 自動更新トリガは付けない。channel_accounts 等の既存 channel 表も
--     auto-trigger を持たず、更新は store 側で updated_at を明示セットする慣行に合わせる。
-- =============================================================================

create table if not exists public.channel_event_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  -- claimed group（channel_groups の active 行）。limbo購読は作らない＝NOT NULL。
  group_id uuid not null,
  account_id uuid not null references public.channel_accounts(id) on delete restrict,
  -- Google Chat の空間名 "spaces/XXX"（= channel_groups.external_group_id のスナップショット）
  space_name text not null,
  -- Workspace Events API の subscription リソース名 "subscriptions/XXX"。
  -- 作成前は null（先に行を立て、API 作成成功後に setEventSubscriptionResource で埋める）。
  subscription_resource_name text,
  status text not null default 'active'
    check (status in ('active', 'expired', 'broken', 'deleted')),
  -- Events API が返す失効時刻。renew 走査（status='active' かつ expire_time < now+猶予）で使う。
  expire_time timestamptz,
  last_renew_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- org 境界保護の複合FK（既存 channel_groups_id_org_unique(id, org_id) を参照）。
  foreign key (group_id, org_id) references public.channel_groups(id, org_id) on delete restrict
);

-- 1 claimed group = 1 active subscription（重複購読で同一メッセージが二重取り込みされるのを防ぐ）。
create unique index if not exists channel_event_subscriptions_active_group_unique
  on public.channel_event_subscriptions(group_id) where status = 'active';

-- lifecycle イベント（subscription の期限/削除通知）の逆引き一意性。
create unique index if not exists channel_event_subscriptions_resource_unique
  on public.channel_event_subscriptions(subscription_resource_name)
  where subscription_resource_name is not null;

create index if not exists channel_event_subscriptions_org
  on public.channel_event_subscriptions(org_id);

-- cron の renew 走査用（active かつ expire_time 昇順で失効間近を拾う）。
create index if not exists channel_event_subscriptions_renew
  on public.channel_event_subscriptions(status, expire_time);

comment on table public.channel_event_subscriptions is
  'Google Chat 空間の全メッセージ購読状態（Workspace Events API）。1 claimed group = 1 active。'
  || ' limbo購読は作らない(group_id NOT NULL)。書込は service role のみ・SELECTは内部メンバー。';
comment on column public.channel_event_subscriptions.group_id is
  'channel_groups(active)への参照。limbo（未承認）グループには購読を作らないため NOT NULL';
comment on column public.channel_event_subscriptions.space_name is
  'Google Chat 空間名 "spaces/XXX"（channel_groups.external_group_id のスナップショット）';
comment on column public.channel_event_subscriptions.subscription_resource_name is
  'Events API subscription 名 "subscriptions/XXX"。API作成前は null・作成後にセット（NULL→値）';
comment on column public.channel_event_subscriptions.status is
  'active=購読中 / expired=失効(renew恒久失敗) / broken=拾い停止(記録・digest・完了ループは壊さない) / deleted=空間削除等で撤去済み';
comment on column public.channel_event_subscriptions.expire_time is
  'Events API が返す購読失効時刻。cron の renew 走査（active かつ expire_time が近い）で使う';

-- -----------------------------------------------------------------------------
-- RLS: 読取=org内部メンバーのみ。書込ポリシー無し（service role経由のみ）。
--   channel_groups / channel_group_claims と同じ *_select_internal を踏襲。
-- -----------------------------------------------------------------------------
alter table public.channel_event_subscriptions enable row level security;

revoke all on table public.channel_event_subscriptions from anon, authenticated;
grant select on table public.channel_event_subscriptions to authenticated;

drop policy if exists channel_event_subscriptions_select_internal on public.channel_event_subscriptions;
create policy channel_event_subscriptions_select_internal
  on public.channel_event_subscriptions
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

-- =============================================================================
-- 検証（適用後に service role で実施）:
--   1) 他org の authenticated ユーザーで channel_event_subscriptions が 0行（越境SELECT不可）
--   2) INSERT/UPDATE/DELETE を authenticated が実行できない（policy 無し＝拒否）
--   3) 同一 group_id に status='active' が2件立てられない（部分unique違反）
--   4) 同一 subscription_resource_name（非null）が2件立てられない（部分unique違反）
--   5) group_id/org_id が channel_groups(id, org_id) に無い組み合わせだと複合FK違反
-- ロールバック（全て加算のため巻き戻し可・不可逆な点なし）:
--   drop table public.channel_event_subscriptions;
--   （seed した platform google_chat account 行を消す場合は別途 delete。ただし他への参照が
--     出た後は on delete restrict のため先に子行の除去が必要）
-- =============================================================================
