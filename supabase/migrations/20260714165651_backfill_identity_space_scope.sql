-- =============================================================================
-- fix: rpc_backfill_digest_assignee_identity を顧問先(space)スコープに限定する
--
-- 20260714153028_digest_due_assignee.sql で入れた版は (org_id, external_id) だけで
-- 突合しており、org内の**全space**のopen申し送りを更新していた。
--
-- channel_identities は「同一人物が複数顧問先の窓口になるケース（社長が2法人経営等）」を
-- space 違いで明示的に許容している（active一意 = (org_id, channel, external_id, space_id)、
-- 20260710204722_channel_plumbing.sql:72 のコメント参照）。
-- そのため旧版では、A社の窓口としてidentityが作られた瞬間に、**B社（別顧問先）の申し送り**まで
-- そのidentityに紐付き、顧問先をまたいだ担当の誤帰属が起きる。
--
-- 対策: identity の space_id と一致する申し送りだけを更新する。
-- （channel_digest_tasks.space_id は group からデノーマライズ済み）
-- =============================================================================

create or replace function public.rpc_backfill_digest_assignee_identity(
  p_identity_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_space_id uuid;
  v_external_id text;
  v_channel text;
  v_updated int := 0;
begin
  select org_id, space_id, external_id, channel
    into v_org_id, v_space_id, v_external_id, v_channel
  from channel_identities
  where id = p_identity_id and status = 'active';

  -- assignee_external_user_id はLINEのuserIdしか入らない。
  -- 他チャネル（emailのアドレス等）のidentityで誤って突合しないようチャネルを固定する
  if v_org_id is null or v_channel <> 'line' then
    return 0;
  end if;

  update channel_digest_tasks
  set assignee_identity_id = p_identity_id
  where org_id = v_org_id
    -- ★顧問先スコープ。これが無いと別顧問先の申し送りに担当が付く
    and space_id = v_space_id
    and status = 'open'
    and assignee_identity_id is null
    and assignee_external_user_id = v_external_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.rpc_backfill_digest_assignee_identity(uuid) from public, anon, authenticated;
grant execute on function public.rpc_backfill_digest_assignee_identity(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 既存データの是正
-- -----------------------------------------------------------------------------
-- 旧版RPCが別顧問先の申し送りに付けてしまった assignee_identity_id を剥がす。
-- （identity.space_id と task.space_id が食い違うもの。開けている申し送りのみ対象。
--   done済みの履歴は書き換えない＝過去の表示は当時のまま残す）
update channel_digest_tasks t
set assignee_identity_id = null
from channel_identities i
where t.assignee_identity_id = i.id
  and t.status = 'open'
  and t.space_id is distinct from i.space_id;

-- =============================================================================
-- ロールバック手順（手動）
--   20260714153028_digest_due_assignee.sql の
--   rpc_backfill_digest_assignee_identity を再適用する（space絞りが外れる＝バグ版に戻る）
-- =============================================================================
