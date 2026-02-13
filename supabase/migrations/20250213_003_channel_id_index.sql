-- channel_id インデックス追加
-- webhook の app_mention / slash commands で channel_id での検索が頻繁に行われるため
create index if not exists idx_space_slack_channels_channel_id
  on space_slack_channels (channel_id);
