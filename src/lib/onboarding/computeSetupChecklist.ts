/**
 * Data needed to derive setup checklist step completion. All fields are
 * booleans pre-computed by the caller (see useSetupChecklistData) so this
 * module stays a pure function and is trivial to unit test.
 */
export interface SetupChecklistData {
  /** org内に is_sample=false（または is_sample 列が無い環境ではフォールバックで任意）のタスクが1件以上ある */
  hasNonSampleTask: boolean
  /** org_memberships に client 以外のロールが2人以上、または内部ロール宛の未承諾招待がある */
  hasTeamInvite: boolean
  /** org_memberships に role='client' のメンバーがいる、またはクライアント宛の未承諾招待がある */
  hasClientInvite: boolean
  /** client_scope='deliverable' かつ is_sample=false（同上フォールバック）のタスクが1件以上ある */
  hasPublishedTask: boolean
  /** profiles.onboarding_flags.portal_preview_seen === true */
  hasPreviewedPortal: boolean
}

export type SetupChecklistStepKey =
  | 'create_task'
  | 'invite_team'
  | 'invite_client'
  | 'publish_task'
  | 'preview_portal'

export interface SetupChecklistStep {
  key: SetupChecklistStepKey
  title: string
  /** 完了時は補足なし、未完了時は次のアクションを促す説明文 */
  description: string
  done: boolean
  /** CTAのリンク先。ページ内操作で完結するステップ(create_task/publish_task)は常に null */
  href: string | null
  ctaLabel: string | null
}

export interface SetupChecklistResult {
  steps: SetupChecklistStep[]
  completedCount: number
  totalCount: number
  allDone: boolean
}

/**
 * 初回セットアップチェックリストの各ステップの完了状態・遷移先・文言を算出する純関数。
 * @param data ステップ判定に必要な真偽値（データ取得は呼び出し側の責務）
 * @param spaceId クライアント表示プレビューのリンク先に使うプロジェクトID
 */
export function computeSetupChecklist(
  data: SetupChecklistData,
  spaceId: string
): SetupChecklistResult {
  const steps: SetupChecklistStep[] = [
    {
      key: 'create_task',
      title: '最初のタスクを作成',
      description: data.hasNonSampleTask
        ? 'タスクを作成しました。'
        : '下の「タスクを追加」からタイトルを入力してEnterで作成できます。',
      done: data.hasNonSampleTask,
      href: null,
      ctaLabel: null,
    },
    {
      key: 'invite_team',
      title: 'チームメンバーを招待',
      description: data.hasTeamInvite
        ? 'チームメンバーを招待しました。'
        : 'いっしょに作業するメンバーを招待しましょう。',
      done: data.hasTeamInvite,
      href: data.hasTeamInvite ? null : '/settings/members',
      ctaLabel: data.hasTeamInvite ? null : 'メンバーを招待',
    },
    {
      key: 'invite_client',
      title: 'クライアントを招待',
      description: data.hasClientInvite
        ? 'クライアントを招待しました。'
        : 'クライアントを招待するとポータルで進捗を共有できます。',
      done: data.hasClientInvite,
      href: data.hasClientInvite ? null : '/settings/members',
      ctaLabel: data.hasClientInvite ? null : 'クライアントを招待',
    },
    {
      key: 'publish_task',
      title: 'タスクをクライアントに公開',
      description: data.hasPublishedTask
        ? 'タスクをクライアントに公開しました。'
        : 'タスク詳細で「クライアントに公開」をONにすると、クライアントのポータルに表示されます。',
      done: data.hasPublishedTask,
      href: null,
      ctaLabel: null,
    },
    {
      key: 'preview_portal',
      title: 'クライアント表示をプレビュー',
      description: data.hasPreviewedPortal
        ? 'クライアント表示をプレビューしました。'
        : 'クライアントからどう見えるかを確認しましょう。',
      done: data.hasPreviewedPortal,
      href: data.hasPreviewedPortal ? null : `/portal/preview/${spaceId}`,
      ctaLabel: data.hasPreviewedPortal ? null : 'プレビュー',
    },
  ]

  const completedCount = steps.filter((s) => s.done).length

  return {
    steps,
    completedCount,
    totalCount: steps.length,
    allDone: completedCount === steps.length,
  }
}
