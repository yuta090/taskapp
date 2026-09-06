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
  /**
   * DM到達不能「安全網」の可視化（任意項目）。現在ユーザー自身のLINE 1:1紐付けが
   * dm_unreachable_at 非NULL(ブロック等で到達不能とマーク済み)か。マーク/解除の書き手は
   * webhookのunfollow/follow・日次照合ジョブ（dmReachabilityReconcile）。connect_line
   * ステップが連携済み(done)のときのみ、控えめな注記として表示する。
   */
  dmUnreachable?: boolean
  /**
   * profiles.onboarding_flags.no_client === true。「クライアントなしで進める」を選んだ。
   * クライアント前提の3ステップ(invite_client/publish_task/preview_portal)を skipped にして
   * 分母から外す（実際に完了していれば done が優先）。
   */
  noClient?: boolean
  /**
   * profiles.onboarding_flags.skip_line === true。「LINE秘書は使わない（この設定はしない）」を選んだ。
   * connect_line を skipped にして分母から外す（実際に連携済みなら done が優先）。導線は残す。
   */
  skipLine?: boolean
  /** profiles.onboarding_flags.skip_ai === true。「AI連携は使わない（この設定はしない）」を選んだ。同上。 */
  skipAi?: boolean
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
  /**
   * 「スキップ」= ユーザーが「クライアントなし」を選んだため今は不要なステップ。
   * pending と同様、一覧には出すが進捗の分母と現在地からは除外する。
   */
  skipped?: boolean
  /** true のとき invite_client ステップに「クライアントなし」の選択肢を出す（未招待・未スキップ時のみ） */
  canMarkNoClient?: boolean
  /**
   * true のとき「この設定はしない」の選択肢を出す（connect_line / configure_ai の未完了・未スキップ時のみ）。
   * 選ぶと skipped になり分母から外れる。設定したくない人がチェックリストを永久に完了できない問題への手当て。
   */
  canSkip?: boolean
  /** true のとき、connect_line ステップに控えめなDM到達不能の注記を出す（SetupChecklist参照） */
  dmUnreachable?: boolean
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
  const noClient = data.noClient === true
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
    buildInviteClientStep(data.hasClientInvite, noClient),
    {
      key: 'publish_task',
      title: 'タスクをクライアントに公開',
      description: data.hasPublishedTask
        ? 'タスクをクライアントに公開しました。'
        : noClient
          ? 'クライアントを招待したら、タスク詳細の「クライアントに公開」で共有できます。'
          : 'タスク詳細で「クライアントに公開」をONにすると、クライアントのポータルに表示されます。',
      done: data.hasPublishedTask,
      href: null,
      ctaLabel: null,
      skipped: noClient && !data.hasPublishedTask,
    },
    {
      key: 'preview_portal',
      title: 'クライアント表示をプレビュー',
      description: data.hasPreviewedPortal
        ? 'クライアント表示をプレビューしました。'
        : noClient
          ? 'クライアントを招待したら、どう見えるかを確認できます。'
          : 'クライアントからどう見えるかを確認しましょう。',
      done: data.hasPreviewedPortal,
      href: data.hasPreviewedPortal || noClient ? null : `/portal/preview/${spaceId}`,
      ctaLabel: data.hasPreviewedPortal || noClient ? null : 'プレビュー',
      skipped: noClient && !data.hasPreviewedPortal,
    },
    buildConnectLineStep(data, orgId),
    buildConfigureAiStep(data),
  ]

  // pending（準備中）・skipped（クライアントなし）ステップは表示のみ。進捗の分母・現在地からは除外する。
  const applicable = steps.filter((s) => s.pending !== true && s.skipped !== true)
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
 * クライアント招待ステップ。未招待のときは「クライアントなし」を選べる（canMarkNoClient）。
 * 選ぶと skipped になり分母から外れるが、あとから招待できるよう導線は残す。
 * 実際に招待済みなら done が優先（noClient は無視）。
 */
function buildInviteClientStep(hasClientInvite: boolean, noClient: boolean): SetupChecklistStep {
  if (hasClientInvite) {
    return {
      key: 'invite_client',
      title: 'クライアントを招待',
      description: 'クライアントを招待しました。',
      done: true,
      href: null,
      ctaLabel: null,
    }
  }

  if (noClient) {
    return {
      key: 'invite_client',
      title: 'クライアントを招待',
      description: 'クライアントなしで進めています。必要になったらいつでも招待できます。',
      done: false,
      href: '/settings/members',
      ctaLabel: '招待する',
      skipped: true,
    }
  }

  return {
    key: 'invite_client',
    title: 'クライアントを招待',
    description: 'クライアントを招待するとポータルで進捗を共有できます。',
    done: false,
    href: '/settings/members',
    ctaLabel: 'クライアントを招待',
    canMarkNoClient: true,
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
  // 手順より先に「連携すると何ができるか」を必ず言う（未申込/申込中/準備中/未連携のどの状態でも同じ一文）
  const benefit = 'グループLINEの会話が自動でタスクになり、期限のお知らせや承認もLINEで受け取れます。'

  if (data.lineAccess === 'unavailable') {
    return {
      key: 'connect_line',
      title: 'LINE秘書と連携',
      // 共有bot未プロビジョニング。自動で使えるようになる誤解を避け、開通の主体＝当社と明示。
      description: `開通すると、${benefit}当社が順番に開通しており、開通しましたらご登録のメールでご案内します（お急ぎの場合はサポートへご連絡ください）。`,
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
      description: `申込を受け付けました。開通すると、${benefit}開通しましたらご登録のメールでご案内します。`,
      done: false,
      href: null,
      ctaLabel: null,
      pending: true,
    }
  }

  // 「この設定はしない」: 未連携なら申込前(none)でも連携可能(own/granted)でも skipped にする。
  // 実際に連携済みなら下の done が優先されるよう、hasLineLinked を先に見る
  if (
    data.skipLine === true &&
    !data.hasLineLinked &&
    (data.lineAccess === 'none' || data.lineAccess === 'own' || data.lineAccess === 'granted')
  ) {
    return {
      key: 'connect_line',
      title: 'LINE秘書と連携',
      description: 'LINE秘書は使わずに進めています。必要になったらいつでも連携できます。',
      done: false,
      href: connectHref,
      ctaLabel: '連携する',
      skipped: true,
    }
  }

  if (data.lineAccess === 'none') {
    return {
      key: 'connect_line',
      title: 'LINE秘書と連携',
      description: `連携すると、${benefit}まずは共通LINEの利用を申し込みます。`,
      done: false,
      href: connectHref,
      ctaLabel: '共通LINEを申し込む',
      canSkip: true,
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
      dmUnreachable: data.dmUnreachable === true,
    }
  }

  return {
    key: 'connect_line',
    title: 'LINE秘書と連携',
    description: `連携すると、${benefit}QRで友だち追加し、表示されるコードをトークに送ると完了です（追加だけでは完了しません）。`,
    done: false,
    canSkip: true,
    href: connectHref,
    ctaLabel: 'LINEを連携',
  }
}

/**
 * AI連携ステップ。未設定なら「この設定はしない」を選べる（canSkip）。
 * 選ぶ（skipAi）と skipped になり分母から外れるが、あとから設定できるよう導線は残す。設定済みなら done が優先。
 */
function buildConfigureAiStep(data: SetupChecklistData): SetupChecklistStep {
  if (data.aiConfigured) {
    return {
      key: 'configure_ai',
      title: 'AI連携を設定',
      description: 'AI連携を設定しました。',
      done: true,
      href: null,
      ctaLabel: null,
    }
  }
  if (data.skipAi === true) {
    return {
      key: 'configure_ai',
      title: 'AI連携を設定',
      description: 'AI連携は使わずに進めています。必要になったらいつでも設定できます。',
      done: false,
      href: '/settings/org-integrations',
      ctaLabel: '設定する',
      skipped: true,
    }
  }
  return {
    key: 'configure_ai',
    title: 'AI連携を設定',
    description:
      'AIを設定すると、LINEのやり取りが自動でタスクになります。未設定のあいだは自動タスク化は動きません。',
    done: false,
    href: '/settings/org-integrations',
    ctaLabel: 'AI連携を設定',
    canSkip: true,
  }
}
