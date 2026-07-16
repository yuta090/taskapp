-- =============================================================================
-- AI秘書 Stage 4: 共有bot disabled 凍結（Fable裁定）— claim RPC への account-status ガード
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §6「status='disabled' の意味論」
--
-- 【背景・Fable裁定（確定）】
--   channel_accounts.status='disabled' は「活性化以前への回帰＝新規テナント確立の凍結」を意味する。
--   webhook 側は code_only redeem を `if (disabled) return`（別途 impl-runner 実装）で凍結するが、
--   ★web_approval のコンソール承認は webhook を通らない★ため、rpc_approve_group_claim
--   （コンソールから呼ばれ channel_groups を新規作成する）が disabled account でも group を
--   作れてしまう「裏口」になる。これを DB 層で塞ぐのが本 migration の主目的。
--
-- 【この migration がすること（加算のみ・forward migration）】
--   1) rpc_approve_group_claim（必須）: 再検証群の中（group INSERT より前）で、claim.account_id の
--      channel_accounts.status を引き、active でなければ GC409 で拒否（＝裏口封鎖）。
--   2) rpc_redeem_code_only_claim（防御的・cheap）: code 検索直後・rejected 記録経路より前・成功
--      INSERT より前で、p_account_id の status を確認し、active でなければ GC409 で raise。
--      webhook が既に凍結するので通常到達しないが、将来 webhook 以外の呼び出しに対する多重防御。
--      ★disabled は「不作為」＝コード非消費・台帳(claims)も触らない（Fable §6 意味論）ため、
--        rejected 記録も残さず raise で即抜ける（consumed_at も channel_group_claims も不変）。
--
-- 【土台】20260716111033_shared_bot_code_only_redeem.sql の errcode 版定義をそのまま踏襲し、
--   ★account-status チェックを1つ足すだけ★。他の検証・ロジック・ロック順序・戻り値・errcode は
--   一切変えない。既存 migration ファイルは書き換えない（[[migration-apply-discipline]]＝forward で直す）。
--   本ファイルは 20260715092425〜20260716111033 適用後に適用される前提（create or replace で上書き）。
--
-- 【errcode 選定】disabled は「今は紐付けできない状態」＝ GC409(conflict)。クライアントは account 再
--   有効化後に再試行できる。既存 SQLSTATE スキーム(GC404/403/409/422)に整合（末尾対応表に追記）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) rpc_approve_group_claim — disabled 凍結ガードを再検証群に1つ追加（他は 20260716111033 と不変）
--    ★下記は 20260716111033 の定義に対し、membership 検証の直後・group INSERT より前へ
--      「対象 account が active か」の1チェックを足したのみ。ロック順序 / TOCTOU 再検証 /
--      各 errcode / 23505 graceful / 単一Tx / 戻り値は完全踏襲。
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

  -- ★共有bot disabled 凍結（Fable裁定 §6）: 対象 platform account が active でなければ承認を凍結する。
  --   web_approval のコンソール承認は webhook を通らないため、ここが disabled account で group を
  --   作れてしまう唯一の裏口。DB層で塞ぐ（webhook の code_only redeem 凍結と対をなす）。
  --   disabled = 「活性化以前への回帰＝新規テナント確立の凍結」＝ 再検証群の一員として fail-closed。
  --   ※target_account_id == v_claim.account_id は上で検証済み。仕様どおり claim.account_id を引く。
  if not exists (
    select 1 from public.channel_accounts a
    where a.id = v_claim.account_id
      and a.status = 'active'
  ) then
    raise exception 'rpc_approve_group_claim: target account is not active (disabled)'
      using errcode = 'GC409';
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
-- 2) rpc_redeem_code_only_claim — disabled 凍結ガードを code 検索直後に追加（他は 20260716111033 と不変）
--    ★下記は 20260716111033 の定義に対し、not-found(GC404) チェックの直後・rejected 記録経路より前・
--      成功 INSERT より前へ「p_account_id が active か」の1チェックを足したのみ。
--      それ以外（wrong_purpose/wrong_binding_mode/consumed/revoked/expired/wrong_account の rejected 記録、
--      not-found=GC404、already_linked=23505 graceful、成功パス、ロック順序、戻り値）は完全踏襲。
--    ★disabled は「不作為」＝コード非消費・台帳不変（Fable §6）ため rejected 記録も残さず raise で抜ける。
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

  -- ★共有bot disabled 凍結（Fable裁定 §6・防御的多重防御）: 対象 platform account が active で
  --   なければ即凍結する。webhook が既に code_only redeem を `if (disabled) return` で凍結するので
  --   通常は到達しないが、将来 webhook 以外の呼び出しに対する DB 層の多重防御として置く。
  --   disabled は「不作為」＝コードを消費せず・台帳(channel_group_claims)も触らない（Fable §6 意味論）。
  --   よって rejected 記録経路より前・成功 INSERT より前で raise し、consumed_at も claims も不変で抜ける。
  --   errcode は GC409（今は紐付けできない状態＝再有効化後に再試行可能）。
  if not exists (
    select 1 from public.channel_accounts a
    where a.id = p_account_id
      and a.status = 'active'
  ) then
    raise exception 'rpc_redeem_code_only_claim: target account is not active (disabled)'
      using errcode = 'GC409';
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
  'code_only 即時償還（service-role専用）。成功=linked（group[code_only_link]＋auto_approved claim＋code消費）／別コード同一グループ競合=already_linked（23505 graceful・敗者コード未消費）／マッチ無効=rejected（content-free rejected claim を (code,account,group) 単位1行で dedup＋events_seen カウンタ＝盗難検知面・DoS 有界）／code不一致=raise GC404／対象account が disabled=raise GC409（コード非消費・台帳不変・Fable §6）。境界は A-1・claim integrity・A-2 トリガーが強制。'
  '呼び出し契約: 1メッセージイベントにつき1回だけ呼ぶ（webhook の event-dedup=externalMessageId と §7-8 レート制限の背後で呼ぶ前提）。p_account_id / p_external_group_id は NOT NULL の有効値を webhook が渡す（不正値の弾きは webhook 側）。entitlement(allow_code_only) 検査は発行側の責務（コード存在＝発行時 entitled が前提・本RPCには無い）。';

-- =============================================================================
-- SQLSTATE(errcode) 対応表 — 本 migration での追加分（20260716111033 の表に GC409 を1行追記）
--
--   SQLSTATE | HTTP | 意味                          | 追加された発生箇所（本 migration）
--   ---------+------+-------------------------------+------------------------------------------------
--   GC409    | 409  | conflict (account disabled)   | approve: 対象 account が status<>'active'（web_approval 裏口封鎖）
--            |      |                               | redeem:  p_account_id が status<>'active'（webhook 以外への多重防御）
--   ---------+------+-------------------------------+------------------------------------------------
--   ※ disabled は「今は紐付けできない状態」なので既存 GC409(conflict) を流用（新 SQLSTATE は増やさない）。
--     クライアントは account 再有効化後に再試行できる。approve/redeem 双方とも既存の GC409 分類に畳まれる
--     ため、アプリの classifyGroupClaimRpcError（SQLSTATE ベース）は変更不要。
--   ※ redeem の disabled は rejected 記録を残さず raise（Fable §6: 不作為＝コード非消費・台帳不変）。
--     ＝ 既存の rejected(記録あり) 経路とは異なる。webhook は GC409 も固定応答＋レート制限へ畳む。
--
-- 検証（使い捨てクラスタで shared_bot_disabled_freeze_data.sql が自動検証）:
--   [approve disabled] disabled account の pending claim を approve → GC409・channel_groups 行が
--     作られない・claim は pending のまま（code 未消費）。
--   [redeem disabled]  disabled account への redeem → GC409・group/claims/consumed いずれも不変
--     （rejected 記録も残さない＝コード非消費）。
--   [退行なし]         active account の approve/redeem 正常系は従来どおり成功（linked / approved）。
--
-- ロールバック（不可逆物なし。全て forward migration で復元可）:
--   -- approve/redeem を account-status チェック無しの 20260716111033 版へ戻す（当該ファイルの
--   --   定義を create or replace で再適用する。ロジックは account-status 以外不変のため戻しても
--   --   機能差は「disabled account への凍結が外れる」のみ）。
--   -- ※本 migration は関数本体の create or replace のみ。テーブル/制約/index/grant の破壊的変更は無い。
--   --   redeem 成功で作られた行等は本 migration に依存しない（20260716111033 と同一の成功パス）。
-- =============================================================================
