-- =============================================================================
-- GitHub のインストールは、1つにつき1つの組織にだけ紐づける
--
-- webhook は installation_id から組織を1つに逆引きしている（src/lib/github/handlers.ts）。
-- 1インストール = 1組織を前提にしているので、installation_id そのものを一意にする
-- （これまでの一意性は (org_id, installation_id) の組だけだった）。
--
-- 本番の状態（2026-09-11 確認）: 1行・組織をまたぐ重複 0 件。
-- 重複が既にある場合は、分かる文言で止める（索引は作られず、何も変わらない）。
-- =============================================================================

do $$
begin
  if exists (
    select 1
      from public.github_installations
     group by installation_id
    having count(*) > 1
  ) then
    raise exception 'github installation unique: 同じ installation_id が複数の行にあるため一意にできません。重複を解消してから流してください';
  end if;
end $$;

create unique index if not exists github_installations_installation_id_key
  on public.github_installations (installation_id);

-- =============================================================================
-- ロールバック
--   drop index if exists public.github_installations_installation_id_key;
-- =============================================================================
