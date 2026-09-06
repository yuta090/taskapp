-- 運営用「組織の詳細」(/admin/organizations/[id]) が org_id で引く2テーブルに索引を足す
--
-- 対象クエリ (src/app/admin/(panel)/organizations/[id]/page.tsx):
--   notifications: .eq('org_id').order('created_at', desc).limit(10)
--     → 既存索引は to_user_id / space_id 起点のみで、org_id 起点は全件スキャンだった
--   spaces:        .eq('org_id')
--     → 既存は type='personal' の部分索引のみ
--
-- 破壊的変更: なし（索引追加のみ）
-- ロック注意: トランザクション内で適用するため「同時実行つき索引作成」は使わない
--   （構築中は対象テーブルへの書き込みが一時停止する。読み取りは止まらない）

create index if not exists notifications_org_created_idx
  on public.notifications (org_id, created_at desc);

create index if not exists spaces_org_idx
  on public.spaces (org_id);
