import {
  FolderSimple,
  UsersThree,
  SealCheck,
  Flag,
  GithubLogo,
  ChatCircleDots,
  VideoCamera,
  Key,
  Export,
  Browser,
  Buildings,
  Warning,
} from '@phosphor-icons/react'
import type { SettingSectionId } from './types'

export interface SettingItem {
  id: SettingSectionId
  label: string
  icon: React.ElementType
  keywords: string[]
  /** プロジェクトの管理者（admin/owner）にだけ見せる項目 */
  adminOnly?: boolean
}

export interface SettingCategory {
  id: string
  label: string
  items: SettingItem[]
}

const allCategories: SettingCategory[] = [
  {
    id: 'project',
    label: 'プロジェクト運用',
    items: [
      { id: 'general', label: '基本設定', icon: FolderSimple, keywords: ['プロジェクト名', '名前', 'name', 'general', 'プリセット', 'テンプレート', 'preset'] },
      { id: 'milestones', label: 'マイルストーン', icon: Flag, keywords: ['期日', 'スケジュール', 'deadline', 'milestone'] },
      { id: 'members', label: 'メンバー', icon: UsersThree, keywords: ['招待', 'ロール', '権限', 'invite', 'role', 'member'] },
      { id: 'approval', label: '社内承認', icon: SealCheck, keywords: ['承認', '承認者', 'レビュー', 'デフォルト', '既定', 'approval', 'reviewer', 'review'] },
      { id: 'portal', label: 'ポータル表示', icon: Browser, keywords: ['ポータル', 'portal', 'クライアント', '表示', '非表示', '公開'] },
      { id: 'agency', label: '代理店モード', icon: Buildings, keywords: ['代理店', 'agency', 'ベンダー', 'vendor', 'マージン', 'margin', '制作会社'] },
    ],
  },
  {
    id: 'integrations',
    label: '外部連携',
    items: [
      { id: 'github', label: 'GitHub', icon: GithubLogo, keywords: ['リポジトリ', 'PR', 'プルリクエスト', 'repository'] },
      { id: 'slack', label: 'Slack', icon: ChatCircleDots, keywords: ['通知', 'チャンネル', 'channel', 'notification'] },
      { id: 'video-conference', label: 'ビデオ会議', icon: VideoCamera, keywords: ['Zoom', 'Teams', 'Meet', 'ミーティング', 'meeting'] },
    ],
  },
  {
    id: 'security',
    label: 'セキュリティ・API',
    items: [{ id: 'api', label: 'APIキー', icon: Key, keywords: ['トークン', 'token', 'key', 'セキュリティ'] }],
  },
  {
    id: 'data',
    label: 'データ管理',
    items: [
      { id: 'export', label: 'データエクスポート', icon: Export, keywords: ['CSV', 'ダウンロード', 'download', 'テンプレート'] },
      {
        id: 'danger',
        label: '危険設定',
        icon: Warning,
        keywords: ['アーカイブ', 'archive', '危険', 'danger', '削除', '非表示'],
        adminOnly: true,
      },
    ],
  },
]

/**
 * 設定メニューの並び。危険設定のように管理者だけに見せる項目はここで落とす。
 * 「いつも目に入る場所に危険な操作を置かない」ため、基本設定ではなくデータ管理の末尾に置いている。
 */
export function getSettingsCategories({ isAdmin }: { isAdmin: boolean }): SettingCategory[] {
  return allCategories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => !item.adminOnly || isAdmin),
    }))
    .filter((category) => category.items.length > 0)
}
