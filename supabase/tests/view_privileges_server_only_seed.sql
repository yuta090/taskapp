-- =============================================================================
-- 連携の状態と AI 利用の集計のビューはサーバーだけが使う（*_view_privileges_server_only.sql）の検証用データ
-- run_view_privileges_server_only.sh が、本 migration の手前までの migrations のあと・本 migration の前に流す。
-- postgres で入れる（RLS は通らない）。
--
-- 表とビューの権限は、Supabase の既定（本番の形）と同じく anon / authenticated にも全部付ける
--   （空の DB では migration が付けた物と代役の既定の権限だけになるので、ここで明示する）。
-- 人物: sa = 運営（二要素認証の登録なし）・u1 = ログイン中の人（運営でない）
-- 連携の設定: github（有効）・slack（無効）
-- AI の利用: 組織 a001 に2件・a002 に1件（同じ月・同じ provider と model）
-- =============================================================================

grant all on table public.system_integration_status, public.app_org_ai_usage_monthly, public.system_integration_configs
  to anon, authenticated;

insert into auth.users(id) values
  ('00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-00000000c002');

-- 運営の旗（postgres なので profiles_superadmin_guard を通る）
update public.profiles set is_superadmin = true
 where id = '00000000-0000-0000-0000-00000000c001';

insert into public.system_integration_configs(provider, enabled, credentials_encrypted) values
  ('github', true, 'enc-github'),
  ('slack', false, 'enc-slack');

insert into public.ai_usage_events(org_id, provider, model, prompt_tokens, completion_tokens, occurred_at) values
  ('00000000-0000-0000-0000-00000000a001', 'openai', 'gpt-x', 10, 5, '2026-09-01T00:00:00Z'),
  ('00000000-0000-0000-0000-00000000a001', 'openai', 'gpt-x', 20, 5, '2026-09-02T00:00:00Z'),
  ('00000000-0000-0000-0000-00000000a002', 'openai', 'gpt-x', 1, 1, '2026-09-03T00:00:00Z');

-- profiles が作られ、運営が1人いる（作られていないと、以降の確かめが別の理由で落ちる）
do $$
begin
  if (select count(*) from public.profiles where is_superadmin) <> 1 then
    raise exception 'seed: 運営が1人になっていません（profiles が作られていない?）';
  end if;
end $$;
