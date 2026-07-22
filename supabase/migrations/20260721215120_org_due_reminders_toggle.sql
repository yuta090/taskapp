-- =============================================================================
-- 自動期限リマインド機能の「事務所(org)単位オンオフ」列 ＋ 更新RPC
--
-- 目的: AI秘書の自動期限リマインド機能を事務所(org)ごとに丸ごと停止できるようにする
--   （既定オン＝オプトアウト思想。事務所が「うちは使わない」と全体で止められる）。
--   個人単位のオプトアウトは既存の profiles.due_reminder_enabled（別軸・そのまま残す）。
--
-- 置き場所の判断（相乗り先＝org_channel_policy）:
--   - org 単位の設定/ポリシーを持つ既存テーブルは org_channel_policy（PK=org_id）が最も自然。
--     既に allow_code_only / monthly_push_quota / shared_bot_access 等の「org 単位フラグ」を
--     束ねており、リマインドの配信面（planner/sender は共有LINE 送信を伴う）とも同じ領域。
--   - 新規 org_settings は作らない（CLAUDE.md/指示どおり最も近い既存に相乗り）。
--   - org_ai_config は api_key_encrypted NOT NULL を要し「自社キーを設定した org にしか行が無い」ため、
--     全 org 共通の機能トグルの器としては不適（無料/共有キー運用の org に行が無い）→ 不採用。
--   - org_channel_policy は「行が無い org＝暗黙デフォルト」を coalesce で扱う既存作法。本列も同様に
--     行が無い org は coalesce(due_reminders_enabled, true)＝有効として扱う（enforcement 側で coalesce）。
--
-- 冪等・前進的: add column if not exists + default true。既存 org_channel_policy 行は全て true で
--   埋まる（機能ON維持＝挙動不変）。行が無い org も coalesce で ON。破壊的変更なし。
--
-- ロールバック観点:
--   列: drop column if exists due_reminders_enabled; で可逆。ただし本列を false（停止）にしていた
--       事務所の選好は drop で失われるため事実上不可逆。前進的運用を前提とし drop はしない想定。
--   RPC/ヘルパ: drop function で可逆（末尾のロールバック節）。
--   -1440 occurrence の掃除(§4): DELETE のため不可逆。ただし消すのは「まだ送っていない pending」
--       だけで、送信済み(sent)/抑止済み(suppressed)の証跡は一切消さない（後述）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) 列
-- -----------------------------------------------------------------------------
alter table public.org_channel_policy
  add column if not exists due_reminders_enabled boolean not null default true;

comment on column public.org_channel_policy.due_reminders_enabled is
  '事務所単位の自動期限リマインド機能オンオフ。false=事務所全体で停止（planner/sender とも生成・送信しない）。個人単位は profiles.due_reminder_enabled。既定 true（オプトアウト思想）。行が無い org は coalesce(...,true) で有効扱い。更新は rpc_set_org_due_reminders_enabled 経由のみ（authenticated の直接書込は無し）。';


-- -----------------------------------------------------------------------------
-- 2) 直接書込は与えない（ベース migration の「書込は service role のみ」契約を維持）
--
-- ★設計判断（当初案の撤回）:
--   当初は「列レベル GRANT（due_reminders_enabled のみ）＋ authenticated 向け UPDATE/INSERT ポリシー」で
--   owner/admin の self-service を許す案だったが、以下2点で不採用とした。
--
--   (a) 実DBで動かない: PostgREST の upsert は
--         insert ... on conflict (org_id) do update set org_id = excluded.org_id,
--                                                       due_reminders_enabled = excluded.due_reminders_enabled
--       に展開される。SET 句に org_id が含まれるため org_id への UPDATE 権限が必要になり、
--       列 GRANT を due_reminders_enabled だけに絞っている限り permission denied for column org_id で
--       必ず失敗する。しかも既存 backfill（20260720201858 のプラン連動トリガー／20260721193407 の
--       app_resync_all_org_push_quota()）でほぼ全 org に policy 行が存在するため、
--       「行が有る＝ON CONFLICT 経路」＝通常経路が丸ごと壊れる。
--
--   (b) 課金境界テーブルに authenticated 書込の前例を作らない: org_channel_policy は
--       allow_code_only / monthly_push_quota / on_exceed / state / shared_bot_access という
--       entitlement・課金列を同居させ、ベース migration（20260715092426）が「★書込は service role のみ」と
--       明示宣言している。行レベルで書込を開けると、将来の列追加のたびに「その列は列 GRANT から漏れているか」
--       を人力で守り続ける必要が生じる（漏れ＝entitlement 自己付与）。境界は開けない。
--
--   → 代わりに SECURITY DEFINER RPC（§3）で「この列だけを書く」動作そのものを固定する。
--     ついでに、当初案が org_memberships をポリシー内でインライン参照していた点（リポジトリ内で唯一・
--     app_is_org_internal 等のヘルパ経由という作法から逸脱）も解消される。
--
-- 読取（SELECT）: 追加ポリシー不要。既存 org_channel_policy_select_internal（20260715092426）が
--   app_is_org_internal(org_id)＝owner/admin/member に SELECT を許すため owner/admin は本列を読める。
--   table 権限も既存の grant select ... to authenticated で足りる（UI の初期表示はこの経路）。
-- -----------------------------------------------------------------------------

-- 旧案が先に適用された環境（ローカル/検証）を確実に元へ戻す。未適用環境では no-op。
drop policy if exists org_channel_policy_update_due_reminders on public.org_channel_policy;
drop policy if exists org_channel_policy_insert_due_reminders on public.org_channel_policy;

-- 列レベル GRANT の撤回。PostgreSQL では table レベルの REVOKE が同種の列レベル権限も落とすが、
-- 意図を明示するため列レベルも先に明示 revoke する（未付与なら no-op）。
revoke update (due_reminders_enabled) on public.org_channel_policy from authenticated;
revoke insert (org_id, due_reminders_enabled) on public.org_channel_policy from authenticated;
revoke insert, update, delete on table public.org_channel_policy from anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3) 更新経路: SECURITY DEFINER RPC（owner/admin のみ・この列だけを書く）
-- -----------------------------------------------------------------------------

-- org の owner または admin か。app_is_org_internal（owner/admin/member）と同じ作法・同じ再帰回避理由で
-- SECURITY DEFINER（RLS をバイパスして org_memberships を直接読む）。
--   ※ 現行の org_memberships.role は ('owner','member','client') 中心で 'admin' は未使用だが、
--     app_is_org_internal と同様に将来の org admin 役割へ前方互換で含める。member は org 全体設定を
--     変更させない（読取のみ）ため対象外。
create or replace function public.app_is_org_owner_or_admin(p_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- SECURITY DEFINER: RLS をバイパスして org_memberships を直接参照する
  select exists(
    select 1 from org_memberships m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  );
$$;
comment on function public.app_is_org_owner_or_admin(uuid) is
  '呼び出しユーザー(auth.uid())が当該 org の owner または admin か。org 全体設定の変更権限判定用（app_is_org_internal は member を含むため設定変更には使わない）。';

-- 事務所単位トグルの唯一の更新経路。
--   - 書くのは due_reminders_enabled のみ。allow_code_only / monthly_push_quota / on_exceed / state /
--     shared_bot_access 等の entitlement 列は insert 時の table default に任せ、update 時は一切触らない
--     （＝org が自分に entitlement を付与する経路にならない）。updated_at は本テーブルの慣行どおり更新する。
--   - 行が無い org（policy 行未作成）は insert 経路で作られる。新規行の他列 default は
--     allow_code_only=false / on_exceed='none' / state='ok' / shared_bot_access='none' /
--     monthly_push_quota=null＝全て安全側。行を作ること自体で権限は増えない。
--   - 権限が無い呼び出しは raise（PostgREST 経由でクライアントにエラーが返り、UI の楽観更新が
--     ロールバックされる。静かに no-op にすると「切ったつもりで切れていない」事故になる）。
create or replace function public.rpc_set_org_due_reminders_enabled(
  p_org_id  uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result boolean;
begin
  if p_org_id is null or p_enabled is null then
    raise exception 'rpc_set_org_due_reminders_enabled: p_org_id and p_enabled are required'
      using errcode = '22004';
  end if;

  -- service_role（管理/運用クライアント）は元々このテーブルを直接書けるため素通し。
  -- それ以外は auth.uid() が当該 org の owner/admin である場合のみ許可（fail-closed）。
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.app_is_org_owner_or_admin(p_org_id) then
    raise exception 'rpc_set_org_due_reminders_enabled: forbidden' using errcode = '42501';
  end if;

  insert into public.org_channel_policy (org_id, due_reminders_enabled)
  values (p_org_id, p_enabled)
  on conflict (org_id) do update
    set due_reminders_enabled = excluded.due_reminders_enabled,
        updated_at = now()
  returning due_reminders_enabled into v_result;

  return v_result;
end;
$$;
comment on function public.rpc_set_org_due_reminders_enabled(uuid, boolean) is
  '事務所単位の自動期限リマインドオンオフを設定する唯一の更新経路。owner/admin のみ（それ以外は 42501）。org_channel_policy の due_reminders_enabled だけを upsert し、entitlement/課金列には触れない。反映後の値を返す。';

revoke all on function public.rpc_set_org_due_reminders_enabled(uuid, boolean) from public, anon;
grant execute on function public.rpc_set_org_due_reminders_enabled(uuid, boolean) to authenticated;
grant execute on function public.rpc_set_org_due_reminders_enabled(uuid, boolean) to service_role;

-- ヘルパは RLS ポリシー/RPC の内部判定用。anon には渡さない。
revoke all on function public.app_is_org_owner_or_admin(uuid) from public, anon;
grant execute on function public.app_is_org_owner_or_admin(uuid) to authenticated;
grant execute on function public.app_is_org_owner_or_admin(uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 4) 既定オフセット変更に伴う後始末: materialize 済みの「1日前」通知を掃除する
--
-- 「うざくない秘書」再設計で既定オフセットが [-1440, 0, +1440] → [0, +1440] に変わった
--   （src/lib/reminders/dueReminderPlanner.ts の DUE_REMINDER_OFFSETS_MINUTES）。
-- planner はコード側で -1440 を作らなくなるが、変更前に既に materialize されている
--   offset_minutes = -1440 の pending occurrence は sender がそのまま拾い、
--   「明日が期限です」を送ってしまう（＝仕様変更後に消したはずの前日通知が飛ぶ）。
-- → 未送信の pending だけを削除する。status が sent / suppressed / canceled / leased の行は触らない
--   （sent/suppressed は送信・抑止の証跡。leased は sender が処理中で、消すと lease 中の行が
--     消えて finalize が行方不明になる。leased は次の finalize で自然に終端する）。
-- 冪等: 再適用しても対象が無くなるだけ（0 行 DELETE）。
-- ロールバック: DELETE は不可逆。ただし復元すべきは「送らないと決めた通知」なので復元不要。
--   万一戻したい場合は planner の既定オフセットに -1440 を戻せば、期限が未来のタスクについては
--   次回 planner 実行で再 materialize される。
-- -----------------------------------------------------------------------------
delete from public.task_due_reminder_occurrences
  where offset_minutes = -1440
    and status = 'pending';


-- =============================================================================
-- 検証（適用後）:
--   1) 既存 org_channel_policy 行は due_reminders_enabled=true。行の無い org は coalesce で ON。
--   2) owner/admin が rpc_set_org_due_reminders_enabled(org, false/true) を呼べて往復できる
--      （行が既に有る org＝backfill 済みの通常ケースでも成功すること）。
--   3) member / 他org ユーザー / 未認証 は 42501 で拒否されること。
--   4) authenticated が org_channel_policy を直接 UPDATE/INSERT できないこと
--      （列 GRANT 撤回＋書込ポリシー無し＝permission denied）。
--   5) RPC 実行後も allow_code_only / monthly_push_quota / on_exceed / state / shared_bot_access が不変。
--   6) 課金トリガー(20260720201858)/resync(20260721193407) の upsert が due_reminders_enabled を
--      潰さないこと（それらは対象列のみ upsert する）。
--   7) offset_minutes=-1440 の pending が 0 件になり、他 offset / 他 status は残ること。
--   → 自動検証: bash supabase/tests/run_org_due_reminders_toggle.sh
--
-- ロールバック:
--   drop function if exists public.rpc_set_org_due_reminders_enabled(uuid, boolean);
--   drop function if exists public.app_is_org_owner_or_admin(uuid);
--   alter table public.org_channel_policy drop column if exists due_reminders_enabled;
--   ※ 削除した -1440 pending occurrence は戻らない（上記 §4 のとおり戻す必要も無い）。
-- =============================================================================
