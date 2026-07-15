-- =============================================================================
-- AI秘書 Stage 4: 共有bot マルチテナント境界 — 手順3 / channel_link_codes 拡張
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §2 / §3 / §6-3 / §7-7
--
-- 目的: 共有botのグループ紐付けコード（shared_group_claim）を既存の友だち特定コード
--   （identity）と同じ表で扱う。binding_mode（web_approval / code_only）を発行時に
--   焼き込み・以後不変にし、償還時は必ずコードの mode のみを参照する（設計正本 §7-7）。
--   生コードは保存せず code_hash（HMAC+pepper・128bit相当）に置換できるよう code を
--   nullable 化する。
--
-- 加算のみ。既存行は purpose default 'identity' で現挙動維持（legacy 友だち特定コード）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) 列追加
-- -----------------------------------------------------------------------------
-- purpose: 既存行は 'identity'（現挙動維持）。NOT NULL default で全既存行を安全に埋める。
alter table public.channel_link_codes
  add column if not exists purpose text not null default 'identity'
  check (purpose in ('identity', 'group_link', 'shared_group_claim'));

-- binding_mode: shared_group_claim 系のみ必須。発行時に焼き込み・以後不変（guardで強制）。
alter table public.channel_link_codes
  add column if not exists binding_mode text
  check (binding_mode in ('web_approval', 'code_only'));

-- 対象 platform account を固定（承認RPCが claim.account_id との一致を再検証する）。
alter table public.channel_link_codes
  add column if not exists target_account_id uuid;

-- 生codeを保存しない方式（shared_group_claim）用の HMAC。128bit相当。
alter table public.channel_link_codes
  add column if not exists code_hash text;

-- 一括発行（本部→各店舗）のグルーピング。
alter table public.channel_link_codes
  add column if not exists batch_id uuid;

-- code_only / web_approval の単回成功管理（NULL→値 一方向・guardで強制）。
alter table public.channel_link_codes
  add column if not exists consumed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'channel_link_codes_target_account_fk') then
    alter table public.channel_link_codes
      add constraint channel_link_codes_target_account_fk
      foreign key (target_account_id) references public.channel_accounts(id) on delete restrict;
  end if;
end $$;

-- 2) code を nullable 化（hash方式併存のため）。既存 UNIQUE(code) は維持されるが、
--    UNIQUE は NULL 重複を許すため hash-only 行（code=NULL）が複数入っても衝突しない。
alter table public.channel_link_codes
  alter column code drop not null;

create index if not exists channel_link_codes_batch
  on public.channel_link_codes(batch_id) where batch_id is not null;
create index if not exists channel_link_codes_target_account
  on public.channel_link_codes(target_account_id) where target_account_id is not null;

comment on column public.channel_link_codes.purpose is
  'identity=友だち本人特定(legacy・既定) / group_link=(予約) / shared_group_claim=共有botグループ紐付け';
comment on column public.channel_link_codes.binding_mode is
  '発行時に焼き込み・以後不変。web_approval=Webコンソール承認 / code_only=承認RPCで即時紐付け（entitlement必須org限定）。償還時はこの mode のみ参照';
comment on column public.channel_link_codes.code_hash is
  'shared_group_claim は生codeを保存せず HMAC+pepper（128bit相当）をここに置く。code列は NULL';
comment on column public.channel_link_codes.consumed_at is
  'web_approval/code_only の単回成功管理。NULL→値 の一方向のみ（マルチユース禁止）';

-- -----------------------------------------------------------------------------
-- 3) 不変性ガード: 焼き込み列の改変を拒否・consumed_at は NULL→値 一方向のみ。
--    既存の更新経路（first_used_at / revoked_at の更新）は従来どおり通す。
-- -----------------------------------------------------------------------------
create or replace function public.channel_link_codes_guard_update()
returns trigger
language plpgsql
as $$
begin
  -- 発行時焼き込み列は完全 immutable（binding_mode 不変・purpose/対象account/hash/batch も固定）。
  -- ★org_id/space_id も immutable: code.org/space は承認RPC・A-1 の紐付け先判断の根拠
  --   （load-bearing）になるため、事後変更で越境を招かないよう固定する。
  if new.purpose is distinct from old.purpose
     or new.binding_mode is distinct from old.binding_mode
     or new.target_account_id is distinct from old.target_account_id
     or new.code_hash is distinct from old.code_hash
     or new.batch_id is distinct from old.batch_id
     or new.org_id is distinct from old.org_id
     or new.space_id is distinct from old.space_id then
    raise exception 'channel_link_codes: binding attributes (purpose/binding_mode/target_account_id/code_hash/batch_id/org_id/space_id) are immutable once issued';
  end if;

  -- consumed_at は NULL→値 の一方向のみ（単回成功の巻き戻し禁止）。
  if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
    raise exception 'channel_link_codes: consumed_at can only be set once';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_channel_link_codes_guard on public.channel_link_codes;
create trigger trg_channel_link_codes_guard
  before update on public.channel_link_codes
  for each row execute function public.channel_link_codes_guard_update();

-- =============================================================================
-- 検証（適用後に service role で実施）:
--   1) 既存 channel_link_codes 全行が purpose='identity' で現挙動維持であること:
--        select count(*) from channel_link_codes where purpose is null;  -- 0
--   2) code=NULL / code_hash 設定の shared_group_claim 行が複数投入でき衝突しないこと。
--   3) 既存経路の first_used_at / revoked_at 更新が従来どおり通ること（guard で拒否されない）。
--   4) binding_mode / purpose / target_account_id / code_hash / batch_id の UPDATE が拒否されること。
--   5) consumed_at を 値→別値/NULL に戻す UPDATE が拒否されること（NULL→値のみ可）。
-- ロールバック:
--   drop trigger trg_channel_link_codes_guard on public.channel_link_codes;
--   drop function public.channel_link_codes_guard_update();
--   drop index channel_link_codes_batch, channel_link_codes_target_account;
--   alter table public.channel_link_codes drop constraint channel_link_codes_target_account_fk;
--   -- ※ code=NULL の hash-only 行が存在する場合、NOT NULL 復帰前に埋め/削除が必要
--   alter table public.channel_link_codes alter column code set not null;
--   alter table public.channel_link_codes
--     drop column consumed_at, drop column batch_id, drop column code_hash,
--     drop column target_account_id, drop column binding_mode, drop column purpose;
-- =============================================================================
