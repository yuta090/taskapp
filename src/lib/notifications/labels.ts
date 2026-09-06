/**
 * 通知タイプ・チャンネルの表示名（日本語）の正本。
 *
 * 受信箱(InboxClient / NotificationInspector)と運営の管理画面(/admin/notifications)で
 * 同じ名前を使うため、ここに一元化する。新しい type を notifications に insert するときは
 * ここにも 1 行足す（漏れは labels.test.ts が検出する）。
 */

export interface NotificationTypeMeta {
  /** 画面に出す短い名前 */
  label: string
  /** 非技術者向けの一言説明（管理画面の補足に使う） */
  description: string
}

export const NOTIFICATION_TYPE_META: Readonly<Record<string, NotificationTypeMeta>> = {
  // ── レビュー・承認 ──
  review_request: {
    label: '社内承認依頼',
    description: 'タスクのレビュー（社内承認）をお願いする通知',
  },
  review_cancelled: {
    label: 'レビュー取消',
    description: '依頼していたレビューが取り下げられた通知',
  },
  spec_decision_needed: {
    label: '仕様決定依頼',
    description: '仕様の決定（判断）が必要になった通知',
  },
  digest_approval_request: {
    label: '申し送りの承認依頼',
    description: 'AI秘書がチャットから拾ったタスク候補の承認をお願いする通知',
  },

  // ── 確認依頼 ──
  confirmation_request: {
    label: '確認依頼',
    description: '内容の確認をお願いする通知',
  },
  urgent_confirmation: {
    label: '緊急確認依頼',
    description: '急ぎで確認をお願いする通知',
  },

  // ── 相手先（クライアント）からの連絡 ──
  client_question: {
    label: '外部からの質問',
    description: '相手先（クライアント）から質問が届いた通知',
  },
  client_feedback: {
    label: '外部からのフィードバック',
    description: '相手先（クライアント）から意見・返答が届いた通知',
  },

  // ── タスクの動き ──
  task_assigned: {
    label: 'タスク割り当て',
    description: 'あなたが担当者に設定された通知',
  },
  ball_passed: {
    label: 'ボール移動',
    description: '次に動く番（ボール）があなた側に回ってきた通知',
  },
  task_completed: {
    label: 'タスク完了',
    description: 'タスクが完了になった通知',
  },
  due_date_reminder: {
    label: '期限リマインダー',
    description: '期限が近い・過ぎたタスクのお知らせ',
  },
  file_uploaded: {
    label: 'ファイル',
    description: 'タスクにファイルが追加された通知',
  },

  // ── 会議・日程調整 ──
  meeting_reminder: {
    label: 'ミーティングリマインダー',
    description: '会議が近づいたときのお知らせ',
  },
  meeting_scheduled: {
    label: 'ミーティング予定',
    description: '会議の予定が入った通知',
  },
  meeting_ended: {
    label: '会議終了',
    description: '会議が終わり、議事録やタスクの確認ができる通知',
  },
  scheduling_reminder: {
    label: '日程調整リマインダー',
    description: '日程調整にまだ回答していない人へのお知らせ',
  },
  scheduling_proposal_expired: {
    label: '日程調整期限切れ',
    description: '日程調整の回答期限が過ぎた通知',
  },

  // ── システム・運営（連携やプランの状態） ──
  sink_error: {
    label: '連携の配達エラー',
    description: 'チャット等への配達が連続で失敗し、連携が止まった通知',
  },
  sink_disabled_relink: {
    label: '連携の停止（再リンク）',
    description: 'グループの付け替えにより、古い連携先への配達を止めた通知',
  },
  pool_ai_exhausted: {
    label: '共有AIの上限到達',
    description: '共有AIの今月の利用上限に達し、自動タスク抽出が一時停止した通知',
  },
  group_claim_linked: {
    label: '共有botグループ紐付け',
    description: '招待コードでチャットグループがプロジェクトに紐付いた通知',
  },
  free_cap_upgrade: {
    label: '無料通知枠の上限到達',
    description: '共通LINEの今月の無料通知枠を使い切った通知（Pro案内）',
  },
}

const FALLBACK_TYPE_LABEL = '通知'

export function getNotificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_META[type]?.label ?? FALLBACK_TYPE_LABEL
}

export function getNotificationTypeDescription(type: string): string {
  return NOTIFICATION_TYPE_META[type]?.description ?? ''
}

export const NOTIFICATION_CHANNEL_LABEL: Readonly<Record<string, string>> = {
  in_app: 'アプリ内',
  email: 'メール',
  line: 'LINE',
  slack: 'Slack',
  discord: 'Discord',
  teams: 'Teams',
  google_chat: 'Google Chat',
  chatwork: 'Chatwork',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
}

export function getNotificationChannelLabel(channel: string): string {
  return NOTIFICATION_CHANNEL_LABEL[channel] ?? channel
}
