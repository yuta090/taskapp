-- Phase 3: ビデオ会議連携
-- spaces テーブルにデフォルトビデオプロバイダー設定カラムを追加
-- meetings テーブルにビデオ会議URL/外部IDカラムを追加

-- spaces にデフォルトビデオプロバイダーカラム追加
alter table spaces
  add column if not exists default_video_provider text null
  check (default_video_provider is null or default_video_provider in ('zoom', 'google_meet', 'teams'));

-- meetings にビデオ会議関連カラム追加
alter table meetings
  add column if not exists meeting_url text null,
  add column if not exists external_meeting_id text null,
  add column if not exists video_provider text null
    check (video_provider is null or video_provider in ('zoom', 'google_meet', 'teams'));
