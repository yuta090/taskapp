import type { LineSelfServeState } from '@/lib/channels/sharedBotAccess'

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
   * 共通LINE の org 単位 利用状態。connect_line ステップを4分岐で出し分ける:
   *   own/granted → 連携できる（連携CTA・hasLineLinked で done）
   *   requested   → 申込受付済み・当社の開通待ち（pending・分母から除外）
   *   none        → 未申込・申込CTA（actionable・分母に含める）
   *   unavailable → 共有bot未プロビジョニング（pending「準備中」）
   */
  lineAccess: LineSelfServeState
  /**
   * org_ai_config に有効なAI設定がある＝夜間の自動タスク抽出(channel-digest)が動く前提が揃っている。
   * false のとき、LINEを繋いでも会話が自動タスク化されない（cronがサイレントにスキップする）。
   * これを可視化するため configure_ai ステップで警告＋設定導線を出す。
   */
  aiConfigured: boolean
}

export type SetupChecklistStepKey =
  | 'create_task'
  | 'invite_team'
  | 'invite_client'
  | 'publish_task'
  | 'preview_portal'
  | 'connect_line'
  | 'configure_ai'

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
    {
      key: 'configure_ai',
      title: 'AI連携を設定',
      description: data.aiConfigured
        ? 'AI連携を設定しました。'
        : 'AIを設定すると、LINEのやり取りが自動でタスクになります。未設定のあいだは自動タスク化は動きません。',
      done: data.aiConfigured,
      href: data.aiConfigured ? null : '/settings/org-integrations',
      ctaLabel: data.aiConfigured ? null : 'AI連携を設定',
    },
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
 * LINE連携ステップを lineAccess の4状態で組み立てる（申込制の per-org 出し分け）:
 * - own/granted かつ連携済み: done。
 * - own/granted かつ未連携: 秘書コンソールへ誘導（QR＋コード送信）。
 * - requested: 申込受付済み・当社の開通待ち（pending・分母から除外・CTAなし）。
 * - none: 未申込。共通LINEの利用申込へ誘導（actionable・分母に含める）。
 * - unavailable: 共有bot未プロビジョニング（pending「準備中」）。
 */
function buildConnectLineStep(data: SetupChecklistData, orgId: string): SetupChecklistStep {
  const connectHref = `/${orgId}/secretary/connect/line`

  if (data.lineAccess === 'unavailable') {
    return {
      key: 'connect_line',
      title: 'LINE秘書と連携',
      // 共有bot未プロビジョニング。自動で使えるようになる誤解を避け、開通の主体＝当社と明示。
      description:
        'LINE秘書は当社にて順次開通しています。開通しましたらご登録のメールでご案内しますので、少々お待ちください（お急ぎの場合はサポートへご連絡ください）。',
      done: false,
      href: null,
      ctaLabel: null,
      pending: true,
    }
  }

  if (data.lineAccess === 'requested') {
    return {
      key: 'connect_line',
      title: 'LINE秘書と連携',
      description:
        '共通LINEの利用申込を受け付けました。当社が開通しましたら、ご登録のメールでご案内します。',
      done: false,
      href: null,
      ctaLabel: null,
      pending: true,
    }
  }

  if (data.lineAccess === 'none') {
    return {
      key: 'connect_line',
      title: 'LINE秘書と連携',
      description:
        '共通LINEの利用をお申し込みください。お申し込み後、当社が開通してメールでご案内します。',
      done: false,
      href: connectHref,
      ctaLabel: '共通LINEを申し込む',
    }
  }

  // own / granted
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
    href: connectHref,
    ctaLabel: 'LINEを連携',
  }
}
