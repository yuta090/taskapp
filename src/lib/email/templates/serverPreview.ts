/**
 * 管理画面プレビュー（server 専用）。
 * React Email 製のテンプレート（承認依頼・滞留リマインド）は react-dom/server で描くのでブラウザでは実行できない。
 * ここで見本データと文面を合わせて描き、POST /api/admin/email-templates/preview から返す。
 * 純粋な renderPreview を持つテンプレートはそちらを使う（同じ関数で送信と一致させるため）。
 */
import { createElement } from 'react'
import { render } from '@react-email/components'
import ApprovalEmail from './ApprovalEmail'
import ReminderEmail from './ReminderEmail'
import { buildEmailCopy, type RenderedEmail, type TemplateFields } from './core'
import { approvalVarsByName, formatCurrencyJpy, type ApprovalTemplateKey } from './approval'
import { reminderVarsByName, type ReminderTemplateKey } from './reminder'
import { getEmailTemplateDef } from './registry'

const PREVIEW_APP_URL = 'https://agentpm.app'

async function renderElement(element: React.ReactElement, subject: string): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])
  return { subject, html, text }
}

async function renderApprovalPreview(key: ApprovalTemplateKey, fields: TemplateFields, appName: string): Promise<RenderedEmail> {
  const isEstimate = key === 'approval_estimate'
  const taskTitle = 'フロントエンド実装 - ログイン画面'
  const spaceName = 'ECサイトリニューアル'
  const orgName = 'クラフトテック'
  const copy = buildEmailCopy(
    fields,
    approvalVarsByName({
      taskTitle,
      spaceName,
      orgName,
      estimatedCostLabel: isEstimate ? formatCurrencyJpy(160000) : '',
      dueDateLabel: '2026/7/10',
      appName,
    }),
  )
  const element = createElement(ApprovalEmail, {
    appName,
    taskTitle,
    spaceName,
    orgName,
    actionUrl: `${PREVIEW_APP_URL}/portal/email-action/xxxxxxxx`,
    portalUrl: `${PREVIEW_APP_URL}/portal`,
    actionType: isEstimate ? 'estimate_approve' : 'approve',
    estimatedCost: isEstimate ? 160000 : null,
    dueDateLabel: '2026/7/10',
    descriptionExcerpt: 'ログイン画面のレイアウトをデザイン通りに実装する',
    copy,
  })
  return renderElement(element, copy.subject)
}

async function renderReminderPreview(key: ReminderTemplateKey, fields: TemplateFields, appName: string): Promise<RenderedEmail> {
  const overdue =
    key === 'reminder_client_overdue'
      ? [{ taskId: 'task-1', title: 'デザイン確認', spaceName: 'ECサイトリニューアル', dueDate: '2026-07-01', daysOverdue: 3 }]
      : []
  const dueToday = [{ taskId: 'task-2', title: '見積もり承認', spaceName: 'ECサイトリニューアル', dueDate: '2026-07-05', daysOverdue: 0 }]
  // 見本の件数は差し込み語の sample（件数2・超過1・本日1）と合わせる（画面上の件名行と食い違わないように）
  const stalled =
    key === 'reminder_client_overdue' ? [] : [{ taskId: 'task-3', title: '原稿の確認', spaceName: 'ECサイトリニューアル', dueDate: null, daysOverdue: 0 }]
  const totalCount = overdue.length + dueToday.length + stalled.length
  const copy = buildEmailCopy(
    fields,
    reminderVarsByName({ displayName: 'クライアント太郎', totalCount, overdueCount: overdue.length, dueTodayCount: dueToday.length, appName }),
  )
  const element = createElement(ReminderEmail, {
    appName,
    displayName: 'クライアント太郎',
    overdue,
    dueToday,
    stalled,
    appUrl: PREVIEW_APP_URL,
    settingsUrl: `${PREVIEW_APP_URL}/portal/settings`,
    copy,
  })
  return renderElement(element, copy.subject)
}

/** 台帳のキーなら必ず描ける（純粋 renderPreview があればそれ、無ければ React Email）。台帳外は null */
export async function renderEmailPreview(key: string, fields: TemplateFields, appName: string): Promise<RenderedEmail | null> {
  const def = getEmailTemplateDef(key)
  if (!def) return null
  if (def.renderPreview) return def.renderPreview(fields, appName)
  if (key === 'approval_task' || key === 'approval_estimate') return renderApprovalPreview(key, fields, appName)
  if (key === 'reminder_client' || key === 'reminder_client_overdue') return renderReminderPreview(key, fields, appName)
  throw new Error(`[email-templates] no preview renderer for key: ${key}`)
}
