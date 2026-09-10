/**
 * マニュアルの目次 — 単一の真実源。
 *
 * 以前は同じ並びを3箇所（SectionIndex のカード / PrevNextNav の前後リンク /
 * ManualLanding の「N 記事」バッジ）に手で書いていたため、ページを足すたびにズレた。
 * 実際に `internal/slack-setup.md` はどこからも辿れず、記事数バッジも実数と合っていなかった。
 *
 * ここに1回書けば、カード・前後ナビ・記事数がすべて揃う。
 * 並び順＝画面に出る順（読む順）。ファイル名（slug）は docs/manual/<section>/<slug>.md と一致させる。
 * ズレは src/__tests__/lib/docs/manualNav.test.ts が両方向（目次→ファイル / ファイル→目次）で検査する。
 */

export const MANUAL_SECTIONS = ['internal', 'client'] as const

export type ManualSection = (typeof MANUAL_SECTIONS)[number]

export interface ManualNavEntry {
  /** docs/manual/<section>/<slug>.md のファイル名部分 */
  slug: string
  /** カードの見出し */
  title: string
  /** カードの補足（1行・何が書いてあるか） */
  description: string
}

export const MANUAL_NAV: Record<ManualSection, ManualNavEntry[]> = {
  internal: [
    { slug: 'getting-started', title: 'はじめに・初期設定', description: 'アカウント作成・最初の設定' },
    { slug: 'dashboard', title: 'ダッシュボード', description: 'KPI・リスク・フォローアップ' },
    { slug: 'my-tasks', title: 'マイタスク', description: '全プロジェクト横断の担当タスク' },
    { slug: 'inbox', title: '受信トレイ', description: '通知確認・アクション実行' },
    { slug: 'tasks', title: 'タスク管理', description: '作成・編集・ボール管理' },
    { slug: 'meetings', title: '会議管理', description: '議事録・決定事項・タスク生成' },
    { slug: 'wiki', title: 'Wiki・仕様管理', description: 'ページ作成・カスタムブロック' },
    { slug: 'files', title: 'ファイル', description: 'アップロード・共有・CSVを表で見る' },
    { slug: 'reviews', title: 'レビュー・承認', description: '承認フロー・監査証跡' },
    { slug: 'scheduling', title: '日程調整', description: '提案・確定・カレンダー連携' },
    { slug: 'secretary', title: 'AI秘書・チャット連携', description: 'LINE/Slack等をつなぐ・使い方' },
    { slug: 'integrations', title: 'ツール連携', description: '他のタスク管理ツールとつなぐ' },
    { slug: 'slack-setup', title: 'Slack連携のはじめかた', description: 'ワークスペース接続・通知' },
    { slug: 'notifications', title: '通知ガイド', description: '届き方・設定・届かない時' },
    { slug: 'settings', title: 'プロジェクト設定', description: 'メンバー・承認・連携・表示' },
    { slug: 'user-settings', title: 'ユーザー・組織設定', description: 'アカウント・組織・外部連携' },
    { slug: 'security', title: 'ログインとセキュリティ', description: '二要素認証・端末通知・APIキー' },
    { slug: 'billing', title: 'プランと請求', description: '無料/Proの違い・支払い・見積もり' },
    { slug: 'cli', title: 'コマンドライン（agentpm）', description: 'CSV取り込み・ファイル送信' },
    { slug: 'mcp-guide', title: 'MCP（AI連携）', description: 'ツール一覧・会話例' },
    { slug: 'troubleshooting', title: 'トラブルシューティング', description: 'よくある問題と対処法' },
    { slug: 'glossary', title: '用語集', description: '専門用語の一覧' },
  ],
  client: [
    { slug: 'getting-started', title: 'はじめに', description: 'ポータルへのアクセス方法' },
    { slug: 'dashboard', title: 'ダッシュボード', description: 'プロジェクト全体の状況確認' },
    { slug: 'tasks', title: 'タスクの確認と対応', description: '確認・コメント・回答' },
    { slug: 'approvals', title: '承認・レビュー', description: '承認・修正依頼の操作' },
    { slug: 'meetings', title: '会議と日程調整', description: '日程回答・決定事項の確認' },
    { slug: 'files', title: 'ファイル', description: '資料の受け取りと受け渡し' },
    { slug: 'wiki', title: 'Wiki（仕様・決めごと）', description: '決まったことを読む' },
    { slug: 'requests', title: '依頼を送る', description: '追加のお願い・質問を出す' },
    { slug: 'troubleshooting', title: 'お困りの場合', description: 'よくある問題と解決方法' },
  ],
}

export function getManualNavEntries(section: ManualSection): ManualNavEntry[] {
  return MANUAL_NAV[section]
}

/** 「N 記事」表示用。目次に載っている数＝実ページ数（テストで保証）。 */
export function getManualArticleCount(section: ManualSection): number {
  return MANUAL_NAV[section].length
}
