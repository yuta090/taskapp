-- =============================================================================
-- AI秘書 Stage 4: 共有bot マルチテナント境界 — 手順1 / channel_accounts.owner_type
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §2 / §6-1 / §7-1
--
-- 目的: 当社所有の「共有bot（platform）」と従来の「顧客専用bot（org）」を
--   単一テーブル channel_accounts で共存させる。共有bot資格情報は org を持たない
--   （org_id=NULL）ため、未改修パスは org_id NOT NULL 違反で fail-closed に落ち、
--   他社への黙った誤帰属を構造的に防ぐ（設計正本 §0 / §2 の本質的価値）。
--
-- 加算のみ・既存行無変更（既存の専用botは全て owner_type='org' に整合）。
-- DDL順序が重要: 列追加(default 'org') → org_id の NOT NULL 解除 → 整合CHECK追加。
-- =============================================================================

-- 1) owner_type 追加。既存行は default 'org' で埋まり、既存の org_id(NOT NULL)と整合。
alter table public.channel_accounts
  add column if not exists owner_type text not null default 'org'
  check (owner_type in ('org', 'platform'));

comment on column public.channel_accounts.owner_type is
  'org=顧客専用bot（org_id必須・白ラベル・従来経路）/ platform=当社共有bot（org_id=NULL・表示名固定）。org検索(findLineAccountForOrg等)は owner_type=''org'' を明示条件に加えること';

-- 2) org_id の NOT NULL を解除（共有bot=platform は org を持たない）。
alter table public.channel_accounts
  alter column org_id drop not null;

-- 3) owner_type と org_id の整合CHECK: org⇔org_id有 / platform⇔org_id無。
--    既存行は (owner_type='org') = (org_id is not null) = (true)=(true) で合格。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'channel_accounts_owner_org_consistency'
  ) then
    alter table public.channel_accounts
      add constraint channel_accounts_owner_org_consistency
      check ((owner_type = 'org') = (org_id is not null));
  end if;
end $$;

-- =============================================================================
-- 検証（適用後に service role で実施。設計正本 §8）:
--   1) 既存 channel_accounts 全行が owner_type='org' かつ org_id is not null であること:
--        select count(*) from channel_accounts where owner_type='org' and org_id is null;  -- 0
--   2) platform account の投入が可能で、org_id=NULL が通ること:
--        insert into channel_accounts(owner_type, channel, display_name, credentials_encrypted)
--        values ('platform','line','agentpm秘書','<enc>');  -- 成功
--   3) 整合CHECK違反が拒否されること:
--        insert ... ('platform', <org>, ...);   -- 拒否（platformにorg_id）
--        insert ... ('org', NULL, ...);          -- 拒否（orgにorg_id無し）
--   4) RLS は 20260710204722 のまま（channel_accounts は資格情報＝authenticated 一切不可）。
--      本migrationは RLS/grant を変更しない。
-- ロールバック（不可逆な点なし・全て加算のため巻き戻し可）:
--   alter table public.channel_accounts drop constraint channel_accounts_owner_org_consistency;
--   -- ※ 先に platform 行（org_id=NULL）を削除/移行してからでないと NOT NULL 復帰は失敗する
--   alter table public.channel_accounts alter column org_id set not null;
--   alter table public.channel_accounts drop column owner_type;
-- =============================================================================
