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
  /** 現在ユーザー自身の active な LINE user-link（identity）が存在する＝自分がLINE秘書と連携済み */
  hasLineLinked: boolean
  /**
   * org に active な LINE の channel_accounts がある＝ユーザーが自分で連携を始められる状態。
   * false のときは白ラベルBotが未プロビジョニング（運営作業待ち）なので、connect_line は
   * 「準備中」表示にして完了不能なCTAを見せない。
   */
  lineAccountReady: boolean
}

export type SetupChecklistStepKey =
  | 'create_task'
  | 'invite_team'
  | 'invite_client'
  | 'publish_task'
  | 'preview_portal'
  | 'connect_line'

export interface SetupChecklistStep {
  key: SetupChecklistStepKey
  title: string
  /** 完了時は補足なし、未完了時は次のアクションを促す説明文 */
  description: string
  done: boolean
  /** CTAのリンク先。ページ内操作で完結するステップ(create_task/publish_task)は常に null */
  href: string | null
  ctaLabel: string | null
  /**
   * 「準備中」= ユーザーが今は完了できない情報表示ステップ（例: LINE秘書が未プロビジョニング）。
   * pending ステップは一覧には出すが、進捗の分母（totalCount）と現在地(currentStepKey)からは除外する。
   * 完了不能なステップで allDone に到達できなくなるのを防ぐため。
   */
  pending?: boolean
}

export interface SetupChecklistResult {
  steps: SetupChecklistStep[]
  completedCount: number
  totalCount: number
  allDone: boolean
  /** 最初の未完了かつ実行可能（非pending）なステップ。全完了なら null。UIの「現在地」強調に使う */
  currentStepKey: SetupChecklistStepKey | null
}

/**
 * 初回セットアップチェックリストの各ステップの完了状態・遷移先・文言を算出する純関数。
 * @param data ステップ判定に必要な真偽値（データ取得は呼び出し側の責務）
 * @param spaceId クライアント表示プレビューのリンク先に使うプロジェクトID
 * @param orgId LINE連携ハブ（秘書コンソール）へのリンクに使う組織ID
 */
export function computeSetupChecklist(
  data: SetupChecklistData,
  spaceId: string,
  orgId: string
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
    buildConnectLineStep(data, orgId),
  ]

  // pending（準備中）ステップは表示のみ。進捗の分母・現在地からは除外する。
  const applicable = steps.filter((s) => s.pending !== true)
  const completedCount = applicable.filter((s) => s.done).length
  const totalCount = applicable.length
  const currentStep = applicable.find((s) => !s.done)

  return {
    steps,
    completedCount,
    totalCount,
    allDone: totalCount > 0 && completedCount === totalCount,
    currentStepKey: currentStep ? currentStep.key : null,
  }
}

/**
 * LINE連携ステップを3状態で組み立てる:
 * - 未準備(lineAccountReady=false): 準備中。ユーザーは完了できないので pending・CTAなし。
 * - 準備済み・未連携: 秘書コンソール(connect/line)へ誘導。QRで友だち追加→コード送信で完了する旨を説明。
 * - 連携済み: done。
 */
function buildConnectLineStep(data: SetupChecklistData, orgId: string): SetupChecklistStep {
  if (!data.lineAccountReady) {
    return {
      key: 'connect_line',
      title: 'LINE秘書と連携',
      description:
        'あなたの事務所のLINE秘書を準備中です。準備ができ次第ここから連携できます（お急ぎの場合はサポートへ）。',
      done: false,
      href: null,
      ctaLabel: null,
      pending: true,
    }
  }

  if (data.hasLineLinked) {
    return {
      key: 'connect_line',
      title: 'LINE秘書と連携',
      description: 'LINE秘書と連携しました。',
      done: true,
      href: null,
      ctaLabel: null,
    }
  }

  return {
    key: 'connect_line',
    title: 'LINE秘書と連携',
    description:
      'QRで友だち追加し、表示されるコードをトークに送ると連携完了です（追加だけでは連携されません）。',
    done: false,
    href: `/${orgId}/secretary/connect/line`,
    ctaLabel: 'LINEを連携',
  }
}
