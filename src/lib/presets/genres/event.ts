/**
 * イベント企画 プリセット
 * 企画書, タイムライン, 備品・手配リスト
 */

import type { PresetDefinition, PresetWikiPage } from '../index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

function generatePlanBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '企画書' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'イベントの企画内容をまとめてください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'イベント概要' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'イベント名: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '目的: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '日時: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '会場: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '想定参加者数: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '予算: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'プログラム' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '時間', styles: { bold: true } }], [{ type: 'text', text: '内容', styles: { bold: true } }], [{ type: 'text', text: '担当', styles: { bold: true } }], [{ type: 'text', text: '備考', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '受付' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '開会' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '閉会' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
  ])
}

function generateTimelineBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'タイムライン' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '準備から振り返りまでのスケジュールを管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '時期', styles: { bold: true } }], [{ type: 'text', text: 'タスク', styles: { bold: true } }], [{ type: 'text', text: '担当', styles: { bold: true } }], [{ type: 'text', text: '完了', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '3ヶ月前' }], [{ type: 'text', text: '会場予約・企画確定' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '2ヶ月前' }], [{ type: 'text', text: '登壇者調整・集客開始' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '1ヶ月前' }], [{ type: 'text', text: '資料準備・リハーサル' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '1週間前' }], [{ type: 'text', text: '最終確認・備品手配' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '当日' }], [{ type: 'text', text: '運営・記録' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '翌週' }], [{ type: 'text', text: '振り返り・レポート' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
  ])
}

function generateSuppliesBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '備品・手配リスト' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '必要な備品と手配状況を管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '会場・設備' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '項目', styles: { bold: true } }], [{ type: 'text', text: '数量', styles: { bold: true } }], [{ type: 'text', text: '手配先', styles: { bold: true } }], [{ type: 'text', text: 'ステータス', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: 'プロジェクター' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未手配 / 手配済み' }]] },
      { cells: [[{ type: 'text', text: 'マイク' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '受付机' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '印刷物・配布物' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '品目', styles: { bold: true } }], [{ type: 'text', text: '部数', styles: { bold: true } }], [{ type: 'text', text: '入稿日', styles: { bold: true } }], [{ type: 'text', text: 'ステータス', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: 'パンフレット' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '名札' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'ケータリング・飲食' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '業者: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '人数: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '予算: ', styles: { bold: true } }, { type: 'text', text: '' }] },
  ])
}

function generateHomeBody(orgId: string, spaceId: string, specPages?: SpecPageRef[]): string {
  const basePath = `/${orgId}/project/${spaceId}`
  const wikiPath = `${basePath}/wiki`

  const specBlocks = specPages && specPages.length > 0
    ? specPages.map(spec => ({
        type: 'bulletListItem',
        content: [{ type: 'link', href: `${wikiPath}?page=${spec.id}`, content: [{ type: 'text', text: spec.title }] }],
      }))
    : [{ type: 'bulletListItem', content: [{ type: 'text', text: '（ドキュメントリンク未設定）' }] }]

  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'イベント概要' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'イベント名: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '日時: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '会場: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '主催: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'ドキュメント' }] },
    ...specBlocks,
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '関連ページ' }] },
    { type: 'bulletListItem', content: [{ type: 'link', href: basePath, content: [{ type: 'text', text: 'タスク一覧' }] }] },
    { type: 'bulletListItem', content: [{ type: 'link', href: `${basePath}/meetings`, content: [{ type: 'text', text: '議事録' }] }] },
  ])
}

const wikiPages: PresetWikiPage[] = [
  { title: '企画書', tags: ['イベント', '企画', 'テンプレート'], generateBody: () => generatePlanBody() },
  { title: 'タイムライン', tags: ['イベント', 'スケジュール', 'テンプレート'], generateBody: () => generateTimelineBody() },
  { title: '備品・手配リスト', tags: ['イベント', '備品', 'テンプレート'], generateBody: () => generateSuppliesBody() },
  { title: 'プロジェクトホーム', tags: ['ホーム', 'テンプレート'], generateBody: generateHomeBody, isHome: true },
]

export const eventPreset: PresetDefinition = {
  genre: 'event',
  label: 'イベント企画',
  description: '企画書・タイムライン・備品手配管理',
  icon: 'CalendarDays',
  wikiPages,
  milestones: [
    { name: '企画', orderKey: 1 },
    { name: '準備', orderKey: 2 },
    { name: '集客', orderKey: 3 },
    { name: '当日運営', orderKey: 4 },
    { name: '振り返り', orderKey: 5 },
  ],
  recommendedIntegrations: ['google_calendar', 'slack', 'video_conference'],
  defaultSettings: { ownerFieldEnabled: true },
}
