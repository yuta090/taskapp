import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember, requireOrgAdmin } from '@/lib/channels/authz'
import {
  findChannelAccountMetaForOrg,
  findChannelAccountOrgId,
  findChannelAccountOwnerType,
  updateChannelAccountStatus,
  orgUsesSharedBot,
  registerOrgChannelAccount,
  generateChannelWebhookSecret,
  type ChannelAccountMeta,
} from '@/lib/channels/store'
import {
  getChannel,
  requiredCredentialFields,
  generatedCredentialFields,
} from '@/lib/channels/registry'
import { fetchChatworkAccountId } from '@/lib/channels/chatwork/client'
import { verifySlackToken } from '@/lib/channels/slack/probe'
import { isValidUuid } from '@/lib/uuid'
import { resolveOrgEntitlements } from '@/lib/billing/entitlements'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/** orgId/credentials_encryptedを含まないワイヤ向けの表現 */
function toWireAccount(meta: ChannelAccountMeta) {
  return {
    id: meta.id,
    channel: meta.channel,
    displayName: meta.displayName,
    lineBotUserId: meta.lineBotUserId,
    status: meta.status,
    createdAt: meta.createdAt,
    ownerType: meta.ownerType,
  }
}

/**
 * GET /api/channels/accounts?orgId= — 秘書コンソールのbot状態カード用
 *
 * 内部メンバー(owner/admin/member)なら閲覧可。credentials_encryptedは選択自体しない。
 * viewerRoleを返し、フロントは owner/admin のときのみ有効/無効トグルを表示する。
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId') ?? ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const account = await findChannelAccountMetaForOrg(orgId)
  // 自社LINE(org account)が無くても、共通LINE(共有bot)のグループを持つなら「利用中」を伝える。
  // 自社LINEがあるならそれが接続状態なので共有判定は不要（Stripe/LINE呼び出しを省く）。
  const sharedBotInUse = account ? false : await orgUsesSharedBot(orgId)
  return NextResponse.json({
    account: account ? toWireAccount(account) : null,
    sharedBotInUse,
    viewerRole: auth.role,
  })
}

/**
 * PATCH /api/channels/accounts — bot有効/無効の切替。owner/adminのみ。
 *
 * accountIdの実所属org(サーバ側でservice roleにより解決)に対して権限確認する。
 * リクエストボディのorgIdは受け取らない(クライアント申告のorg境界を信用しない)。
 *
 * 課金ゲート（own_line_account・確立/有効化のみ）: 専用bot(owner_type='org')を
 * status='active' にする操作（新規登録の完了 or 無効化からの再有効化）は Pro 以上限定。
 * Free org は 402 own_line_account_required で拒否する。status='disabled'（無効化）は
 * プラン不問で常に許可する — 既存の専用bot接続を失効orgから強制的に切ることはしない
 * （このAPIはユーザー自身の無効化操作のみを扱い、こちらから切ることはない）。
 * 共有bot(owner_type='platform')の有効/無効はこのゲートの対象外。
 */
export async function PATCH(request: NextRequest) {
  let body: { accountId?: unknown; status?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const accountId = typeof body.accountId === 'string' ? body.accountId : ''
  const status = typeof body.status === 'string' ? body.status : ''

  if (!isValidUuid(accountId)) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  }
  if (status !== 'active' && status !== 'disabled') {
    return NextResponse.json({ error: "status must be 'active' or 'disabled'" }, { status: 400 })
  }

  const orgId = await findChannelAccountOrgId(accountId)
  if (!orgId) {
    return NextResponse.json({ error: 'account not found' }, { status: 404 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (status === 'active') {
    const ownerType = await findChannelAccountOwnerType(accountId)
    if (ownerType === 'org') {
      const admin = createAdminClient() as SupabaseClient
      const ent = await resolveOrgEntitlements(admin, orgId)
      if (!ent.has('own_line_account')) {
        return NextResponse.json(
          {
            error: 'own_line_account_required',
            code: 'own_line_account_required',
            message: 'Proプランで自社LINE(専用bot)を有効化できます。',
          },
          { status: 402 },
        )
      }
    }
  }

  const updated = await updateChannelAccountStatus(accountId, status)
  if (!updated) {
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ account: toWireAccount(updated) })
}

/**
 * POST /api/channels/accounts — 非LINEチャットチャネルの資格情報登録（作成/ローテート）。
 *
 * owner/admin のみ。org_id/owner_type はサーバー側で固定（owner_type='org'／白ラベル）。
 * platform（共有bot）はこの経路では作らせない（当社がプロビジョニングする別系統）。
 *
 * 課金ゲート（own_line_account・Pro専有）: 自社アカウントを繋ぐ（＝白ラベルの org account）操作は
 * Pro 以上限定。Free org は 402 own_line_account_required で拒否する（共通LINE/共有botはこの経路外）。
 *
 * サーバー生成フィールド（telegram.webhook_secret 等・registry の generated=true）は
 * ここで生成して credentials に含めて保存し、平文は generatedSecrets として一度だけ返す
 * （オペレーターが provider 側の setWebhook 等に設定するため）。
 * 生成secret・資格情報はレスポンスの account には一切含めない。
 */
export async function POST(request: NextRequest) {
  let body: { orgId?: unknown; channel?: unknown; displayName?: unknown; credentials?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const channel = typeof body.channel === 'string' ? body.channel : ''
  const credentialsIn =
    body.credentials && typeof body.credentials === 'object'
      ? (body.credentials as Record<string, unknown>)
      : {}

  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const def = getChannel(channel)
  if (!def || def.kind !== 'chat') {
    return NextResponse.json({ error: 'unknown channel', code: 'unknown_channel' }, { status: 400 })
  }
  // LINE は line_bot_user_id 逆引き等の専用フローがあるため、この汎用経路には載せない。
  if (channel === 'line') {
    return NextResponse.json(
      { error: 'LINEは専用の接続フローを使用してください', code: 'line_dedicated_flow' },
      { status: 400 },
    )
  }
  // planned（アダプタ未実装）や送信不可のチャネルは接続対象外。
  if (def.status === 'planned' || !def.outbound) {
    return NextResponse.json(
      { error: 'このチャネルはまだ接続できません', code: 'channel_not_connectable' },
      { status: 400 },
    )
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // 自社アカウント（白ラベルの org account）を繋ぐのは Pro 専有。
  const admin = createAdminClient() as SupabaseClient
  const ent = await resolveOrgEntitlements(admin, orgId)
  if (!ent.has('own_line_account')) {
    return NextResponse.json(
      {
        error: 'own_line_account_required',
        code: 'own_line_account_required',
        message: 'Proプランで自社アカウント（白ラベル）を接続できます。',
      },
      { status: 402 },
    )
  }

  // 必須フィールド（generated/optional を除く）を検証しつつ operatorCredentials を組む。
  const operatorCredentials: Record<string, string> = {}
  for (const field of requiredCredentialFields(def)) {
    const raw = credentialsIn[field.key]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value === '') {
      return NextResponse.json(
        { error: `${field.label} は必須です`, code: 'missing_credential', field: field.key },
        { status: 400 },
      )
    }
    operatorCredentials[field.key] = value
  }
  // optional フィールドは入力があれば取り込む（無くても登録できる）。
  for (const field of def.credentialFields) {
    if (field.generated || !field.optional) continue
    const raw = credentialsIn[field.key]
    if (typeof raw === 'string' && raw.trim() !== '') {
      operatorCredentials[field.key] = raw.trim()
    }
  }

  // Chatwork: 受信Webの自己ループ防止のため、Bot自身の account_id を /me で解決して控える。
  // （受信 message_created は Bot 自身の投稿も配信するため、senderId==bot_account_id を無視する）。
  // 併せて api_token の有効性検証にもなる。解決不能は fail-closed で 400。
  if (channel === 'chatwork') {
    const botAccountId = await fetchChatworkAccountId(operatorCredentials.api_token)
    if (!botAccountId) {
      return NextResponse.json(
        {
          error: 'Chatwork APIトークンを検証できませんでした。トークンを確認して再試行してください',
          code: 'chatwork_token_unverified',
        },
        { status: 400 },
      )
    }
    operatorCredentials.bot_account_id = botAccountId
  }

  // Slack: 受信Webの自己ループ防止・自分宛メンション判定のため、Bot自身の user_id を
  // auth.test で解決して控える（Chatwork の bot_account_id と同役割）。
  // 併せて必要scope（chat:write・メッセージ読取）の付与も検証する（fail-closed）。
  // bot_token の有効性検証にもなる。
  if (channel === 'slack') {
    const probe = await verifySlackToken(operatorCredentials.bot_token)
    if (!probe.ok && probe.code === 'slack_missing_scope') {
      return NextResponse.json(
        {
          error: `Slack Botに必要な権限(scope)が不足しています: ${probe.detail}`,
          code: 'slack_missing_scope',
        },
        { status: 400 },
      )
    }
    if (!probe.ok) {
      return NextResponse.json(
        {
          error: 'Slack Bot Tokenを検証できませんでした。トークンを確認して再試行してください',
          code: 'slack_token_unverified',
        },
        { status: 400 },
      )
    }
    operatorCredentials.bot_user_id = probe.botUserId
  }

  // サーバー生成フィールド（webhook_secret 等）を生成する。
  const generatedCredentials: Record<string, string> = {}
  for (const field of generatedCredentialFields(def)) {
    generatedCredentials[field.key] = generateChannelWebhookSecret()
  }

  const displayName =
    typeof body.displayName === 'string' && body.displayName.trim() !== ''
      ? body.displayName.trim()
      : def.label

  const { account, created, generatedSecrets } = await registerOrgChannelAccount({
    orgId,
    channel,
    displayName,
    operatorCredentials,
    generatedCredentials,
  })

  // 受信Webhook URL（{accountId} は実IDへ解決）。オペレーターが provider 側に設定する。
  const webhookUrl = def.webhookPath
    ? new URL(
        def.webhookPath.replace('{accountId}', account.id),
        request.nextUrl.origin,
      ).toString()
    : null

  return NextResponse.json(
    {
      account: toWireAccount(account),
      created,
      // ローテート時は既存の生成secretを維持した値（store が決定）。UI表示用に一度だけ返す。
      generatedSecrets,
      webhookUrl,
    },
    { status: created ? 201 : 200 },
  )
}
