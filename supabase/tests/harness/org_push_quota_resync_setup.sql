-- =============================================================================
-- resync 検証セットアップ: quota migration(201858) 適用後・resync migration(205553) 適用前に流す。
-- (#2) org_billing 行が無い org と、(drift) stale な quota 値を用意し、apply時 resync が是正するのを見る。
-- =============================================================================
set client_min_messages = warning;

-- (#2) organizations はあるが org_billing 行が無い org（backfill 対象外だった）。
insert into public.organizations values ('00000000-0000-0000-0000-0000000000c9');

-- (drift) b1(free) は quota migration の backfill で 50 が入っているはず。誤値 999 に汚して
-- resync が 50 へ是正することを見る。
update public.org_channel_policy
  set monthly_push_quota = 999
  where org_id = '00000000-0000-0000-0000-0000000000b1';
