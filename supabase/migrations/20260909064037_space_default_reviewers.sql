-- プロジェクトごとの「既定の承認者」を持たせる。
-- 社内承認を依頼するたびに同じ人を選び直すのが手間なので、承認者選択の初期値を
-- プロジェクト設定に置く。あくまで初期値で、その場で足し引きできる。
--
-- 可視性・更新権限は既存の spaces RLS(spaces_select_member / spaces_update_member)に
-- そのまま従う。spaces には列単位の GRANT を敷いていないため、テーブル権限が新しい列にも及ぶ。
-- profiles への外部キーは付けない(uuid[] には張れない)。抜けた人は画面側で
-- resolveDefaultReviewerIds が落とす。

alter table public.spaces
  add column if not exists default_reviewer_ids uuid[] not null default '{}'::uuid[];

comment on column public.spaces.default_reviewer_ids is
  '社内承認の既定の承認者(user_id の配列)。承認者選択の初期値として使う。スペースを抜けた人は画面側で除外する';
