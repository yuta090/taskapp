-- =============================================================================
-- AI秘書 Stage 4: 共有bot マルチテナント境界 — PR3b / code_only 即時償還RPC＋errcode標準化(L3)
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §1 / §3 / §4 / §7-8 / §10
--
-- 本ファイルの2本柱（加算のみ・forward migration）:
--   1) rpc_redeem_code_only_claim（新規・service-role専用）: webhook が、ユーザーが
--      LINEグループへ投入した code_only コード（code_hash）で **人の承認なしに即時紐付け**する。
--      人の承認バックストップが無いぶん、境界を守るのは DB制約と A-1 トリガー（唯一の網）。
--      成功時は channel_groups(tenant_source='code_only_link') INSERT ＋ 同一Txで
--      channel_group_claims の auto_approved 行記録 ＋ code の consumed_at 消費。
--      マッチした無効コードは content-free の rejected claim を記録（＝盗難検知面。§4）。
--
--   2) errcode 標準化(L3): claim RPCファミリ（approve / reject / redeem）を、アプリが
--      **SQLSTATE(errcode)で 404/403/409/422 分類できる**よう統一する。既存の
--      rpc_approve_group_claim / rpc_reject_group_claim は文言のみで raise しており、
--      アプリがメッセージ部分一致で分類していて脆い（文言変更で静かに劣化）。ここで
--      **ロジック・検証内容・ロック順序・戻り値を一切変えず**、各 raise に `using errcode=`
--      を足すだけの forward migration（create or replace）を行う。既存 migration ファイル
--      （20260715092425）は書き換えない（[[migration-apply-discipline]]＝forward で直す）。
--
-- ★境界は本ファイルの RPC の正しさに依存しない。A-1(channel_groups_tenant_integrity)・
--   claim insert-integrity・A-2(guard) の各トリガーが code_only 経路でも発火し、
--   group.org==code.org・target_account一致・binding_mode対応 を構造的に強制する。
--   本RPCは「それらに守られる側」として組む（設計正本 §3/§7-8）。
--
-- ★entitlement(allow_code_only) 検査は**発行側(PR3b app)の責務**。コードが存在する＝
--   発行時に entitled だった、が前提（§3）。本RPCには entitlement 検査を入れない。
--
-- 日付は JST（now() at time zone 'Asia/Tokyo'）で解釈する運用に合わせるが、本ファイルの
--   時刻列は全て timestamptz（絶対時刻）なので now() をそのまま用いる（TZ変換は不要）。
--   ※TTL/expires_at 等は絶対時刻比較で、表示側が Asia/Tokyo に変換する。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) 表境界の追加（加算のみ・DoS 有界化＋検知 index＋code_hash 双方向 CHECK）
--    ★独立2レビュー(Opus/Codex)の REQUEST CHANGES 反映。テナント境界は不変・強化のみ。
-- -----------------------------------------------------------------------------
-- 0-a) code_hash は shared_group_claim 専用（双方向 CHECK）。
--   既存 channel_link_codes_shared_claim_shape は「shared ⇒ code_hash NOT NULL」の片方向のみ。
--   逆「code_hash NOT NULL ⇒ purpose='shared_group_claim'」が無いと、非shared行にも code_hash を
--   設定でき、rpc_redeem がそれを掴んで wrong_purpose 分岐に入り、rejected claim INSERT が
--   claim insert-integrity（purpose 必須）に P0001 で弾かれ「GC404以外 raise しない」契約に違反する。
--   ここで双方向にし、redeem の code 検索を purpose='shared_group_claim' に安全に限定する根拠を作る。
--   ★既存データが違反しない前提（shared 以外に code_hash を入れる経路は存在しない）。違反ゼロを
--     移行前に確認: select count(*) from channel_link_codes where code_hash is not null
--       and purpose <> 'shared_group_claim';  -- 期待 0
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'channel_link_codes_code_hash_shared_only'
                   and conrelid = 'public.channel_link_codes'::regclass) then
    alter table public.channel_link_codes
      add constraint channel_link_codes_code_hash_shared_only
      check (code_hash is null or purpose = 'shared_group_claim');
  end if;
end $$;

-- 0-b) rejected claim の dedup（DoS 有界化・必須2）。
--   漏洩した失効/消費済みコードの再送で victim org の channel_group_claims を無限肥大できる穴を塞ぐ。
--   (link_code_id, account_id, external_group_id) ごとに rejected は1行に有界化し、再送は
--   events_seen カウンタで数える（rpc_redeem が INSERT ... ON CONFLICT DO UPDATE で使う）。
create unique index if not exists channel_group_claims_rejected_unique
  on public.channel_group_claims(link_code_id, account_id, external_group_id)
  where status = 'rejected';

-- 0-c) 検知/レート集計 index（必須3）。
--   既存 channel_group_claims_org_pending は status='pending' のみ。code_only の盗難検知/レート集計は
--   rejected/auto_approved を org 単位で引くため、専用 partial index が無いと seqscan＋肥大する。
create index if not exists channel_group_claims_org_detect
  on public.channel_group_claims(org_id, created_at)
  where status in ('rejected', 'auto_approved');

-- -----------------------------------------------------------------------------
-- L3-a) rpc_approve_group_claim — errcode を付与（ロジック・戻り値は不変）
--   ★下記は 20260715092425 の定義と1文字も違わない（各 raise に using errcode= を足すのみ）。
--   ロック順序 link_codes FOR UPDATE → claim FOR UPDATE / TOCTOU 再検証 / C1 /
--   23505 graceful（channel_groups_active_unique のみ握る）/ 単一Tx を完全踏襲。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_approve_group_claim(
  p_claim_id uuid,
  p_approver_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link_code_id uuid;
  v_lc record;
  v_claim record;
  v_constraint text;
begin
  -- ロック順序を確定するため、まず claim から link_code_id だけを軽く読む（ロック取得はしない）。
  select link_code_id into v_link_code_id
  from public.channel_group_claims
  where id = p_claim_id;

  if v_link_code_id is null then
    raise exception 'rpc_approve_group_claim: unknown claim_id %', p_claim_id
      using errcode = 'GC404';
  end if;

  -- (1) link_codes 行を FOR UPDATE で先に掴む。
  --     ★code を単一の真実源にする（設計正本 §3/§7-8「紐付け先は常に code.org_id/space_id のみ」）。
  --       org_id/space_id もここから取り、INSERT・membership 検証に用いる。
  --       revoked_at も同一ロック下で読む（運用者の正式な失効手段を尊重）。
  select id, purpose, binding_mode, target_account_id, consumed_at, expires_at, revoked_at, org_id, space_id
    into v_lc
  from public.channel_link_codes
  where id = v_link_code_id
  for update;

  -- (2) 次に claim 行を FOR UPDATE。
  select id, link_code_id, account_id, external_group_id, org_id, space_id,
         group_display_name_snapshot, status
    into v_claim
  from public.channel_group_claims
  where id = p_claim_id
  for update;

  -- ★TOCTOU: ロック前の無施錠読み(v_link_code_id)以後に claim.link_code_id が
  --   別コードへ書き換えられていないかを、ロック確定後に再検証する
  --   （結合列 immutable ガードとの二重防御。設計正本 §3 承認RPCの規律）。
  if v_claim.link_code_id is distinct from v_lc.id then
    raise exception 'rpc_approve_group_claim: claim link_code_id changed under lock (TOCTOU): % <> %',
      v_claim.link_code_id, v_lc.id
      using errcode = 'GC409';
  end if;

  -- 再検証（いずれか失敗で拒否）。
  if v_claim.status is distinct from 'pending' then
    raise exception 'rpc_approve_group_claim: claim % is not pending (status=%)', p_claim_id, v_claim.status
      using errcode = 'GC409';
  end if;
  if v_lc.purpose is distinct from 'shared_group_claim' then
    raise exception 'rpc_approve_group_claim: link_code purpose must be shared_group_claim (got %)', v_lc.purpose
      using errcode = 'GC422';
  end if;
  if v_lc.binding_mode is distinct from 'web_approval' then
    raise exception 'rpc_approve_group_claim: link_code binding_mode must be web_approval (got %)', v_lc.binding_mode
      using errcode = 'GC422';
  end if;
  if v_lc.consumed_at is not null then
    raise exception 'rpc_approve_group_claim: link_code already consumed'
      using errcode = 'GC409';
  end if;
  if v_lc.revoked_at is not null then
    raise exception 'rpc_approve_group_claim: link_code has been revoked'
      using errcode = 'GC422';
  end if;
  if v_lc.expires_at <= now() then
    raise exception 'rpc_approve_group_claim: link_code expired'
      using errcode = 'GC422';
  end if;
  if v_lc.target_account_id is distinct from v_claim.account_id then
    raise exception 'rpc_approve_group_claim: link_code target_account_id does not match claim account'
      using errcode = 'GC422';
  end if;

  -- ★C1: claim と code の org/space 乖離を大声で検出する。
  --   claim は PR2 の別 service-role コードが作るため、そこにバグ/侵害があれば
  --   victim org のコードを消費して attacker org にグループが渡り得る。
  --   コードを単一の真実源にし、乖離は fail-closed で拒否する。
  if v_claim.org_id is distinct from v_lc.org_id
     or v_claim.space_id is distinct from v_lc.space_id then
    raise exception 'rpc_approve_group_claim: claim org/space (%/%) does not match link_code (%/%)',
      v_claim.org_id, v_claim.space_id, v_lc.org_id, v_lc.space_id
      using errcode = 'GC422';
  end if;

  -- 承認者が code.org_id の内部メンバー（owner/admin/member）であること。
  -- ★紐付け先 org は常に code 由来（v_lc.org_id）。claim.org には依存しない。
  -- ★app_is_org_internal は auth.uid() ベースで service definer 内では使えないため、
  --   明示的に p_approver_user_id で org_memberships を直接引く（RLSはdefinerでバイパス）。
  if not exists (
    select 1 from public.org_memberships m
    where m.org_id = v_lc.org_id
      and m.user_id = p_approver_user_id
      and m.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'rpc_approve_group_claim: approver % is not an internal member of org %', p_approver_user_id, v_lc.org_id
      using errcode = 'GC403';
  end if;

  -- 新世代グループを作成（org/space は ★code 由来。A-1 トリガーが整合を再検証する）。
  -- 同一グループへの2claim同時承認は channel_groups_active_unique が最終審判。
  -- 敗者の 23505 は graceful reject（リトライしない）。
  begin
    insert into public.channel_groups (
      org_id, space_id, account_id, channel, external_group_id,
      display_name, status, tenant_source, bound_by_link_code_id
    ) values (
      v_lc.org_id, v_lc.space_id, v_claim.account_id, 'line', v_claim.external_group_id,
      v_claim.group_display_name_snapshot, 'active', 'approved_link_code', v_lc.id
    );
  exception when unique_violation then
    -- ★channel_groups_active_unique の時のみ graceful reject（他の unique violation は握り潰さない）。
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'channel_groups_active_unique' then
      raise;
    end if;
    -- 既にこのグループは active 世代が存在する（別claim が先に成立）。
    -- コードは消費せず、この claim を却下扱いで pending から外す。
    update public.channel_group_claims
    set status = 'rejected', rejected_at = now()
    where id = p_claim_id;
    return false;
  end;

  -- コード消費（単回成功）。
  update public.channel_link_codes
  set consumed_at = now()
  where id = v_lc.id;

  -- claim を承認確定。
  update public.channel_group_claims
  set status = 'approved', approved_by = p_approver_user_id, approved_at = now()
  where id = p_claim_id;

  return true;
end;
$$;

revoke execute on function public.rpc_approve_group_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_approve_group_claim(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- L3-b) rpc_reject_group_claim — errcode を付与（ロジック・戻り値は不変）
--   ★下記は 20260715092425 の定義と1文字も違わない（各 raise に using errcode= を足すのみ）。
--   not-pending は従来どおり raise せず false 返し（UPDATE ... where status='pending'）。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_reject_group_claim(
  p_claim_id uuid,
  p_approver_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link_code_id uuid;
  v_lc record;
  v_claim record;
  v_updated int;
begin
  -- ロック順序を確定するため、まず claim から link_code_id を無施錠で読む。
  select link_code_id into v_link_code_id
  from public.channel_group_claims
  where id = p_claim_id;

  if v_link_code_id is null then
    raise exception 'rpc_reject_group_claim: unknown claim_id %', p_claim_id
      using errcode = 'GC404';
  end if;

  -- (1) link_code → (2) claim の順でロック（approve と同一順序でデッドロック回避）。
  select id, org_id into v_lc
  from public.channel_link_codes
  where id = v_link_code_id
  for update;

  select id, link_code_id, status into v_claim
  from public.channel_group_claims
  where id = p_claim_id
  for update;

  -- TOCTOU 再検証（claim結合列 immutable との二重防御）。
  if v_claim.link_code_id is distinct from v_lc.id then
    raise exception 'rpc_reject_group_claim: claim link_code_id changed under lock (TOCTOU)'
      using errcode = 'GC409';
  end if;

  -- membership は ★code.org に対して。
  if not exists (
    select 1 from public.org_memberships m
    where m.org_id = v_lc.org_id
      and m.user_id = p_approver_user_id
      and m.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'rpc_reject_group_claim: approver % is not an internal member of org %', p_approver_user_id, v_lc.org_id
      using errcode = 'GC403';
  end if;

  update public.channel_group_claims
  set status = 'rejected', rejected_at = now()
  where id = p_claim_id
    and status = 'pending';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke execute on function public.rpc_reject_group_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_reject_group_claim(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 1) rpc_redeem_code_only_claim — code_only 即時償還（service-role専用・Fable §4）
--
--   戻り値 text（結果種別・非封鎖オラクル用に webhook が同一バイト列へ畳む）:
--     'linked'         成功（新グループ＋auto_approved claim＋code消費）
--     'already_linked' 別コードで同一グループが既に active（23505 graceful・code未消費）
--     'rejected'       マッチした無効コード（失効/消費済/revoke/他account/binding_mode不一致）。
--                      content-free の rejected claim を記録済み（＝盗難検知面）。
--   raise（errcode）:
--     GC404            code_hash がどのコードにも一致しない（記録対象が無い＝rejected 非記録）。
--
--   ★なぜ「マッチ無効」は raise せず return するか:
--     rejected claim の記録は盗難検知の唯一面（§4）。raise すると同一Txがロールバックして
--     記録も消える。そこで「記録が要る無効ケースは return 'rejected'（記録は残る）」、
--     「記録対象が無い not-found のみ raise GC404」に分ける。webhook は 'rejected' も
--     GC404 も同一の固定応答＋レート制限に畳む（応答オラクル非封鎖・§7-5/§7-8）。
--
--   ロック順序: channel_link_codes 行 FOR UPDATE → 生成物（groups/claims）。同一コードの
--     並行償還は FOR UPDATE で直列化され、2本目はロック解放後に consumed_at を見て 'rejected'。
--     別コード×同一グループの競合のみ channel_groups_active_unique の 23505 → 'already_linked'。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_redeem_code_only_claim(
  p_code_hash text,
  p_account_id uuid,
  p_external_group_id text,
  p_group_display_name text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lc record;
  v_constraint text;
  v_reject_reason text;
begin
  -- (1) code_hash でコードを引き FOR UPDATE（生成物より先にロック＝ロック順序固定）。
  --     ★purpose='shared_group_claim' に限定する（0-a の双方向 CHECK が code_hash を shared 専用に
  --       保証するので実質冗長だが、防御的に明示）。これにより下の wrong_purpose 分岐は真に到達不能
  --       になり、rejected claim INSERT が claim insert-integrity に弾かれる契約違反が構造的に消える。
  select id, purpose, binding_mode, target_account_id, consumed_at, expires_at, revoked_at, org_id, space_id
    into v_lc
  from public.channel_link_codes
  where code_hash = p_code_hash
    and purpose = 'shared_group_claim'
  for update;

  -- not-found: 記録対象が無い（コード不一致では rejected claim を作らない）。GC404 で raise。
  if v_lc.id is null then
    raise exception 'rpc_redeem_code_only_claim: no matching link code for supplied hash'
      using errcode = 'GC404';
  end if;

  -- (2) 検証。1つでも外れたら「マッチした無効コード」＝ content-free rejected claim を記録して
  --     return 'rejected'（記録を残すため raise しない）。
  if v_lc.purpose is distinct from 'shared_group_claim' then
    v_reject_reason := 'wrong_purpose';        -- ★到達不能（(1)で purpose='shared_group_claim' に限定・
                                               --   0-a CHECK で code_hash は shared 専用）。防御的に残置。
  elsif v_lc.binding_mode is distinct from 'code_only' then
    v_reject_reason := 'wrong_binding_mode';   -- web_approval コードを code_only 経路で使わせない。
  elsif v_lc.consumed_at is not null then
    v_reject_reason := 'consumed';             -- 単回成功。2グループ目/再投入は消費済みで拒否。
  elsif v_lc.revoked_at is not null then
    v_reject_reason := 'revoked';              -- 運用者の正式失効。
  elsif v_lc.expires_at <= now() then
    v_reject_reason := 'expired';              -- TTL 超過。
  elsif v_lc.target_account_id is distinct from p_account_id then
    v_reject_reason := 'wrong_account';        -- 対象 platform account 不一致。
  else
    v_reject_reason := null;                   -- 全て合格。
  end if;

  if v_reject_reason is not null then
    -- content-free rejected claim を記録（org/space は ★code 由来 → claim insert-integrity を通る）。
    -- challenge_label に理由種別のみ格納（会話本文ではない・盗難検知/監視用）。
    -- ★DoS 有界化（必須2）: (link_code_id, account_id, external_group_id) ごとに rejected は1行。
    --   再送は events_seen カウンタで数える（漏洩コード連投で victim org の台帳を肥大させられない）。
    --   UPSERT の UPDATE パスは claim guard を通る: join列は SET しない＝不変・status は
    --   'rejected'→'rejected' の同値維持（guard は new.status=old.status を許容）・events_seen/
    --   last_event_at/challenge_label は可変列。BEFORE INSERT integrity は挿入試行時に発火し通る
    --   （purpose は shared 限定済・org/space は code 由来）。
    insert into public.channel_group_claims (
      link_code_id, account_id, external_group_id, org_id, space_id,
      group_display_name_snapshot, challenge_label, status, rejected_at,
      events_seen, last_event_at
    ) values (
      v_lc.id, p_account_id, p_external_group_id, v_lc.org_id, v_lc.space_id,
      p_group_display_name, v_reject_reason, 'rejected', now(),
      1, now()
    )
    on conflict (link_code_id, account_id, external_group_id) where status = 'rejected'
    do update set
      events_seen = channel_group_claims.events_seen + 1,
      last_event_at = now(),
      challenge_label = excluded.challenge_label;  -- 最新理由を反映
    return 'rejected';
  end if;

  -- (3) 成功パス: 新世代グループを INSERT（org/space/bound は★code 由来）。
  --     A-1(channel_groups_tenant_integrity) が code_only_link⇔binding_mode='code_only'・
  --     target_account 一致・org/space 一致を構造的に再検証する（RPCの正しさに依存しない網）。
  --     別コード×同一グループの競合は channel_groups_active_unique の 23505 → graceful。
  begin
    insert into public.channel_groups (
      org_id, space_id, account_id, channel, external_group_id,
      display_name, status, tenant_source, bound_by_link_code_id
    ) values (
      v_lc.org_id, v_lc.space_id, p_account_id, 'line', p_external_group_id,
      p_group_display_name, 'active', 'code_only_link', v_lc.id
    );
  exception when unique_violation then
    -- ★channel_groups_active_unique の時のみ graceful（他 unique violation は握り潰さず再送出）。
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'channel_groups_active_unique' then
      raise;
    end if;
    -- 既に active 世代が存在（別コードが先に成立）。このコードは消費しない（敗者コード温存）。
    return 'already_linked';
  end;

  -- (4) 同一Txで auto_approved claim を記録（approved_by=null・根拠=bound link_code）。
  --     ★pending を経由しない終端状態（偽の承認ワークフローを作らない・§4）。
  --     claim insert-integrity（claim.org/space==code.org/space, purpose=shared_group_claim）を通る。
  insert into public.channel_group_claims (
    link_code_id, account_id, external_group_id, org_id, space_id,
    group_display_name_snapshot, status
  ) values (
    v_lc.id, p_account_id, p_external_group_id, v_lc.org_id, v_lc.space_id,
    p_group_display_name, 'auto_approved'
  );

  -- (5) コード消費（単回成功・NULL→値 一方向。link_codes guard が巻き戻しを禁止）。
  update public.channel_link_codes
  set consumed_at = now()
  where id = v_lc.id;

  return 'linked';
end;
$$;

revoke execute on function public.rpc_redeem_code_only_claim(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rpc_redeem_code_only_claim(text, uuid, text, text) to service_role;

comment on function public.rpc_redeem_code_only_claim(text, uuid, text, text) is
  'code_only 即時償還（service-role専用）。成功=linked（group[code_only_link]＋auto_approved claim＋code消費）／別コード同一グループ競合=already_linked（23505 graceful・敗者コード未消費）／マッチ無効=rejected（content-free rejected claim を (code,account,group) 単位1行で dedup＋events_seen カウンタ＝盗難検知面・DoS 有界）／code不一致=raise GC404。境界は A-1・claim integrity・A-2 トリガーが強制。'
  '呼び出し契約: 1メッセージイベントにつき1回だけ呼ぶ（webhook の event-dedup=externalMessageId と §7-8 レート制限の背後で呼ぶ前提）。p_account_id / p_external_group_id は NOT NULL の有効値を webhook が渡す（不正値の弾きは webhook 側）。entitlement(allow_code_only) 検査は発行側の責務（コード存在＝発行時 entitled が前提・本RPCには無い）。';

-- =============================================================================
-- SQLSTATE(errcode) 対応表 — claim RPCファミリ共通スキーム（アプリの classifyGroupClaimRpcError
--   を SQLSTATE ベースへ書き換える impl-runner が参照する。custom 5文字 class 'GC')
--
--   SQLSTATE | HTTP | 意味                          | 発生箇所
--   ---------+------+-------------------------------+------------------------------------------------
--   GC404    | 404  | not_found                     | approve/reject: unknown claim_id
--            |      |                               | redeem: code_hash 不一致（記録対象なし）
--   GC403    | 403  | forbidden (membership)        | approve/reject: 承認者が code.org の内部メンバーでない
--   GC409    | 409  | conflict                      | approve: claim not pending / code already consumed /
--            |      |                               |          TOCTOU(link_code_id changed under lock)
--            |      |                               | reject:  TOCTOU
--   GC422    | 422  | invalid                       | approve: purpose≠shared_group_claim / binding_mode≠
--            |      |                               |          web_approval / revoked / expired /
--            |      |                               |          target_account 不一致 / claim.org·space≠code(C1)
--   ---------+------+-------------------------------+------------------------------------------------
--   ※ approve の already-linked（同一グループ2claim競合）は raise せず return false（graceful・23505）。
--   ※ reject の not-pending は raise せず return false（UPDATE ... where status='pending'）。
--   ※ redeem のビジネス無効（expired/consumed/revoked/wrong-account/wrong-binding_mode/wrong-purpose）は
--     rejected claim を残す必要があるため raise せず return 'rejected'（rollback で記録を失わないため）。
--     redeem の already-linked は return 'already_linked'。redeem が raise するのは GC404 のみ。
--   ※ A-1/claim-integrity/link_codes guard トリガー由来の raise は P0001（本スキーム外＝構造網の
--     fail-closed。RPCの正常系では発火しない。発火＝未改修パス/侵害の兆候として上位へ伝播させる）。
--
-- 検証（使い捨てクラスタで shared_bot_code_only_verify.sql が自動検証）:
--   [redeem 成功] linked → channel_groups(tenant_source='code_only_link', bound_by_link_code_id) 1行・
--     auto_approved claim 1行・code.consumed_at 埋まる・group.org==code.org。
--   [redeem 無効→rejected＋記録] expired / consumed / revoked / 他account / web_approval コードの
--     code_only 償還が全て 'rejected' を返し、各々 content-free rejected claim を1行記録する。
--   [redeem not-found] 不一致 hash が GC404 を raise（rejected claim を作らない）。
--   [redeem 2重] 別コード×同一グループの2本目が 23505 graceful で 'already_linked'・敗者コード未消費。
--   [errcode] approve の not-found=GC404 / 他org member=GC403 / expired=GC422 / consumed=GC409 /
--     revoked=GC422 が期待 SQLSTATE で飛ぶ。reject の outsider=GC403。
--   [A-1網] code_only 経路でも group.org==code.org・binding_mode 対応・target_account 一致が強制される。
--
-- ロールバック（不可逆物なし。全て forward migration で復元可）:
--   -- 新規RPCを削除:
--   drop function if exists public.rpc_redeem_code_only_claim(text, uuid, text, text);
--   -- approve/reject を errcode 無しの 20260715092425 版へ戻す（当該ファイルの定義を
--   --   create or replace で再適用する。ロジック不変のため戻しても機能差は無い）。
--   -- 追加した表境界を撤去:
--   drop index if exists public.channel_group_claims_org_detect;
--   drop index if exists public.channel_group_claims_rejected_unique;
--   alter table public.channel_link_codes drop constraint if exists channel_link_codes_code_hash_shared_only;
--   -- ※ redeem 成功で作られた channel_groups(code_only_link) 行・auto_approved claim・
--   --   consumed_at・dedup 済み rejected claim(events_seen) は残る（証跡）。是正は unlink→新世代（§4）。
-- =============================================================================
