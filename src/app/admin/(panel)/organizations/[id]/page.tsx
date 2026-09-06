import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { buildOrgDetail, type OrgDetail, type OrgDetailInput } from '@/lib/admin/org-detail'
import { mapWithConcurrency } from '@/lib/admin/concurrency'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminStatCard } from '@/components/admin/AdminStatCard'
import { OrgAcquisitionEditor } from '@/components/admin/OrgAcquisitionEditor'
import { MilestoneReconcileButton } from '@/components/admin/MilestoneReconcileButton'

export const dynamic = 'force-dynamic'

const RECENT_NOTIFICATIONS_LIMIT = 10
/** auth 側へのメール問い合わせを同時に投げる本数の上限（レート制限で全員のメールが消えるのを防ぐ） */
const EMAIL_LOOKUP_CONCURRENCY = 8
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 組織1件に紐づく情報を、org_id で絞った並列クエリで一括取得する。
 * 行本体を取るのは「この組織のもの」だけ（全件取って JS で絞らない）。
 * 通知は最新 N 件（org_id, created_at の索引あり）、タスク・API キーは件数だけ（head count）。
 */
async function fetchOrgDetail(orgId: string): Promise<OrgDetail | null> {
  const admin = createAdminClient()

  const [
    orgResult,
    membershipsResult,
    spacesResult,
    taskTotalResult,
    taskOpenResult,
    billingResult,
    policyResult,
    groupsResult,
    integrationsResult,
    invitesResult,
    notificationsResult,
    apiKeysResult,
    acquisitionResult,
    milestonesResult,
  ] = await Promise.all([
    admin.from('organizations').select('id, name, created_at').eq('id', orgId).maybeSingle(),
    admin.from('org_memberships').select('user_id, role, created_at').eq('org_id', orgId),
    admin.from('spaces').select('id, name, type, archived_at, created_at').eq('org_id', orgId),
    admin.from('tasks').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
    admin.from('tasks').select('*', { count: 'exact', head: true }).eq('org_id', orgId).neq('status', 'done'),
    admin
      .from('org_billing')
      .select('plan_id, status, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id')
      .eq('org_id', orgId)
      .maybeSingle(),
    admin
      .from('org_channel_policy')
      .select('shared_bot_access, shared_bot_access_requested_at, shared_bot_access_granted_at, state')
      .eq('org_id', orgId)
      .maybeSingle(),
    admin
      .from('channel_groups')
      .select('id, channel, space_id, display_name, external_group_id, status, joined_at')
      .eq('org_id', orgId)
      .order('joined_at', { ascending: false }),
    admin
      .from('integration_connections')
      .select('id, provider, owner_type, status, import_enabled, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    admin.from('invites').select('id, email, role, space_id, expires_at, accepted_at').eq('org_id', orgId),
    admin
      .from('notifications')
      .select('id, type, channel, created_at, read_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(RECENT_NOTIFICATIONS_LIMIT),
    admin.from('api_keys').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
    admin
      .from('org_acquisition')
      .select(
        'channel, channel_source, ref, article_slug, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id, landing_path, referrer, first_touch_at, note, updated_at',
      )
      .eq('org_id', orgId)
      .maybeSingle(),
    admin.from('org_milestones').select('milestone, reached_at, source').eq('org_id', orgId),
  ])

  if (orgResult.error) console.error('[admin/organizations/id] organizations query error:', orgResult.error.message)
  if (!orgResult.data) return null

  const logErr = (name: string, r: { error: { message: string } | null }) => {
    if (r.error) console.error(`[admin/organizations/id] ${name} query error:`, r.error.message)
  }
  logErr('org_memberships', membershipsResult)
  logErr('spaces', spacesResult)
  logErr('tasks(total)', taskTotalResult)
  logErr('tasks(open)', taskOpenResult)
  logErr('org_billing', billingResult)
  logErr('org_channel_policy', policyResult)
  logErr('channel_groups', groupsResult)
  logErr('integration_connections', integrationsResult)
  logErr('invites', invitesResult)
  logErr('notifications', notificationsResult)
  logErr('api_keys', apiKeysResult)
  logErr('org_acquisition', acquisitionResult)
  logErr('org_milestones', milestonesResult)

  const memberships = (membershipsResult.data ?? []) as OrgDetailInput['memberships']
  const spaces = (spacesResult.data ?? []) as OrgDetailInput['spaces']
  const userIds = memberships.map((m) => m.user_id)
  const spaceIds = spaces.map((s) => s.id)

  // メンバーの名前・メールと、スペースごとの参加人数・タスク数は 1 段目の結果（user_id / space_id）が
  // 要るので 2 段目で取る。行本体は profiles だけ、他は in() / head count。メールは auth 側なので
  // 人数分を同時実行数を絞って呼ぶ。
  const [profilesResult, spaceMembersResult, emailEntries, taskCountsBySpace] = await Promise.all([
    userIds.length > 0
      ? admin.from('profiles').select('id, display_name, is_superadmin').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    spaceIds.length > 0
      ? admin.from('space_memberships').select('space_id').in('space_id', spaceIds)
      : Promise.resolve({ data: [], error: null }),
    mapWithConcurrency(userIds, EMAIL_LOOKUP_CONCURRENCY, async (uid): Promise<[string, string]> => {
        try {
          const { data, error } = await admin.auth.admin.getUserById(uid)
          if (error) {
            console.error('[admin/organizations/id] getUserById error:', error.message)
            return [uid, '']
          }
          return [uid, data.user?.email ?? '']
        } catch (e: unknown) {
          console.error('[admin/organizations/id] getUserById exception:', e instanceof Error ? e.message : e)
          return [uid, '']
        }
    }),
    Promise.all(
      spaceIds.map(async (sid): Promise<[string, number]> => {
        const r = await admin.from('tasks').select('*', { count: 'exact', head: true }).eq('space_id', sid)
        if (r.error) console.error('[admin/organizations/id] tasks(space) count error:', r.error.message)
        return [sid, r.count ?? 0]
      }),
    ),
  ])
  logErr('profiles', profilesResult)
  logErr('space_memberships', spaceMembersResult)

  return buildOrgDetail({
    org: orgResult.data as OrgDetailInput['org'],
    memberships,
    profiles: (profilesResult.data ?? []) as OrgDetailInput['profiles'],
    emails: new Map(emailEntries),
    spaces,
    taskCounts: {
      total: taskTotalResult.count ?? 0,
      open: taskOpenResult.count ?? 0,
      bySpace: Object.fromEntries(taskCountsBySpace),
    },
    spaceMemberships: (spaceMembersResult.data ?? []) as OrgDetailInput['spaceMemberships'],
    billing: (billingResult.data ?? null) as OrgDetailInput['billing'],
    policy: (policyResult.data ?? null) as OrgDetailInput['policy'],
    channelGroups: (groupsResult.data ?? []) as OrgDetailInput['channelGroups'],
    integrations: (integrationsResult.data ?? []) as OrgDetailInput['integrations'],
    invites: (invitesResult.data ?? []) as OrgDetailInput['invites'],
    notifications: (notificationsResult.data ?? []) as OrgDetailInput['notifications'],
    apiKeyCount: apiKeysResult.count ?? 0,
    acquisition: (acquisitionResult.data ?? null) as OrgDetailInput['acquisition'],
    milestones: (milestonesResult.data ?? []) as OrgDetailInput['milestones'],
    nowMs: Date.now(),
  })
}

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function billingVariant(status: string) {
  if (status === 'active') return 'success' as const
  if (status === 'trialing') return 'info' as const
  if (status === 'past_due') return 'danger' as const
  return 'default' as const
}

function sharedBotVariant(status: string) {
  if (status === 'granted') return 'success' as const
  if (status === 'requested') return 'warning' as const
  return 'default' as const
}

function Section({
  title,
  count,
  href,
  hrefLabel,
  children,
}: {
  title: string
  count?: number
  href?: string
  hrefLabel?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-surface rounded-xl border border-gray-200">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">
          {title}
          {count != null && <span className="ml-2 text-xs font-normal text-gray-400">{count}件</span>}
        </h2>
        {href && (
          <Link href={href} className="text-xs text-indigo-600 hover:underline">
            {hrefLabel ?? '一覧を開く'}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-6 text-center text-sm text-gray-400">
        {message}
      </td>
    </tr>
  )
}

const TH = 'px-5 py-2 text-left text-xs font-medium text-gray-500'
const TD = 'px-5 py-2.5 text-sm text-gray-700'

export default async function AdminOrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // (panel) layout でも門番を通しているが、service role でメールまで取るページなので
  // データ取得の直前でも確認する。
  const currentUserId = await verifySuperadmin()
  if (!currentUserId) redirect('/admin/login')

  const { id } = await params
  if (!UUID_RE.test(id)) notFound()

  const detail = await fetchOrgDetail(id)
  if (!detail) notFound()

  const { stats, billing, sharedBot } = detail

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div>
        <Link
          href="/admin/organizations"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft size={12} /> 組織一覧に戻る
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900">{detail.name}</h1>
          <AdminBadge variant="indigo">{billing.planLabel}</AdminBadge>
          <AdminBadge variant={billingVariant(billing.status)}>{billing.statusLabel}</AdminBadge>
          <AdminBadge variant={sharedBotVariant(sharedBot.status)}>共通LINE: {sharedBot.label}</AdminBadge>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          作成 {formatDateTime(detail.createdAt)} ・ ID <span className="font-mono">{detail.id}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <AdminStatCard label="メンバー" value={stats.memberCount} sub={stats.pendingInviteCount > 0 ? `招待中 ${stats.pendingInviteCount}件` : undefined} />
        <AdminStatCard label="スペース" value={stats.activeSpaceCount} sub={stats.archivedSpaceCount > 0 ? `アーカイブ済み ${stats.archivedSpaceCount}件` : undefined} />
        <AdminStatCard label="タスク" value={stats.taskCount} sub={`未完了 ${stats.openTaskCount}件`} />
        <AdminStatCard
          label="連携"
          value={stats.channelGroupCount + stats.integrationCount}
          sub={`チャット ${stats.channelGroupCount}・ツール ${stats.integrationCount}・APIキー ${stats.apiKeyCount}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="流入経路（どこから来て登録したか）" href="/admin/analytics" hrefLabel="分析を開く">
          <div className="px-5 py-4 space-y-4">
            <OrgAcquisitionEditor
              orgId={detail.id}
              channel={detail.acquisition.channel}
              isManual={detail.acquisition.isManual}
              note={detail.acquisition.note}
            />
            {detail.acquisition.details.length > 0 ? (
              <dl className="text-xs border-t border-gray-100 pt-3 space-y-1">
                <p className="text-gray-500 mb-1">
                  自動で取れた情報{detail.acquisition.firstTouchAt && `（最初の訪問 ${formatDateTime(detail.acquisition.firstTouchAt)}）`}
                </p>
                {detail.acquisition.details.map((d) => (
                  <div key={d.label} className="flex gap-2">
                    <dt className="w-32 shrink-0 text-gray-400">{d.label}</dt>
                    <dd className="text-gray-700 break-all">{d.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
                自動で取れた情報はありません（計測タグや広告パラメータの無いアクセス、または記録開始前の登録）
              </p>
            )}
          </div>
        </Section>

        <Section title="到達した節目" count={detail.milestoneStats.reachedCount}>
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400">
              {detail.milestoneStats.totalCount} 個の節目のうち {detail.milestoneStats.reachedCount} 個に到達
            </p>
            <MilestoneReconcileButton orgId={detail.id} />
          </div>
          <ol className="divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
            {detail.milestones.map((m) => (
              <li key={m.key} className="px-5 py-2 flex items-center gap-3">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${m.reachedAt ? 'bg-indigo-500' : 'bg-gray-200'}`}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${m.reachedAt ? 'text-gray-900' : 'text-gray-400'}`}>
                    {m.label}
                    <span className="ml-2 text-[10px] text-gray-400">{m.groupLabel}</span>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {m.reachedAt ? (
                    <>
                      <p className="text-xs text-gray-700">{formatDateTime(m.reachedAt)}</p>
                      <p className="text-[10px] text-gray-400">
                        作成から {m.daysFromCreation != null && m.daysFromCreation < 1 ? '当日' : `${m.daysFromCreation}日`}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-300">未到達</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <Section title="メンバー" count={detail.members.length} href="/admin/users">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className={TH}>名前</th>
                <th className={TH}>メール</th>
                <th className={TH}>役割</th>
                <th className={TH}>参加日</th>
                <th className={TH}>ユーザーID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detail.members.length === 0 && <EmptyRow colSpan={5} message="メンバーがいません" />}
              {detail.members.map((m) => (
                <tr key={m.userId} className="hover:bg-gray-50">
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{m.displayName || '(未設定)'}</span>
                      {m.isSuperadmin && <AdminBadge variant="indigo">Admin</AdminBadge>}
                    </div>
                  </td>
                  <td className={TD}>{m.email || <span className="text-gray-300">-</span>}</td>
                  <td className={TD}>
                    <AdminBadge variant={m.role === 'owner' ? 'info' : 'default'}>{m.roleLabel}</AdminBadge>
                  </td>
                  <td className={TD}>{formatDate(m.joinedAt)}</td>
                  <td className={TD}>
                    <span className="font-mono text-xs text-gray-500" title={m.userId}>
                      {m.userId.slice(0, 8)}...
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail.pendingInvites.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-xs font-medium text-gray-500 mb-1">招待中（まだ参加していない人）</p>
            <ul className="space-y-0.5">
              {detail.pendingInvites.map((inv) => (
                <li key={inv.id} className="text-xs text-gray-600">
                  {inv.email}（{inv.roleLabel}
                  {inv.spaceName ? `・${inv.spaceName}` : ''}） 期限 {formatDate(inv.expiresAt)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="スペース（プロジェクト）" count={detail.spaces.length} href="/admin/spaces">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className={TH}>名前</th>
                <th className={TH}>種類</th>
                <th className={TH}>参加人数</th>
                <th className={TH}>タスク</th>
                <th className={TH}>状態</th>
                <th className={TH}>作成日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detail.spaces.length === 0 && <EmptyRow colSpan={6} message="スペースがありません" />}
              {detail.spaces.map((s) => (
                <tr key={s.id} className={`hover:bg-gray-50 ${s.isArchived ? 'text-gray-400' : ''}`}>
                  <td className={TD}>
                    <span className={s.isArchived ? 'text-gray-400' : 'font-medium text-gray-900'}>{s.name}</span>
                  </td>
                  <td className={TD}>{s.typeLabel}</td>
                  <td className={TD}>{s.memberCount}</td>
                  <td className={TD}>{s.taskCount}</td>
                  <td className={TD}>
                    <AdminBadge variant={s.isArchived ? 'default' : 'success'}>
                      {s.isArchived ? 'アーカイブ済み' : '稼働中'}
                    </AdminBadge>
                  </td>
                  <td className={TD}>{formatDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="プランと課金" href="/admin/billing">
          <dl className="px-5 py-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-gray-500">プラン</dt>
            <dd className="text-gray-900 font-medium">{billing.planLabel}</dd>
            <dt className="text-gray-500">状態</dt>
            <dd>
              <AdminBadge variant={billingVariant(billing.status)}>{billing.statusLabel}</AdminBadge>
              {billing.cancelAtPeriodEnd && (
                <span className="ml-2 text-xs text-red-600">期間終了で解約予定</span>
              )}
            </dd>
            <dt className="text-gray-500">今の期間の終了</dt>
            <dd className="text-gray-900">{formatDate(billing.currentPeriodEnd)}</dd>
            <dt className="text-gray-500">Stripe 顧客</dt>
            <dd className="font-mono text-xs text-gray-600">{billing.stripeCustomerId ?? '-'}</dd>
            <dt className="text-gray-500">Stripe 契約</dt>
            <dd className="font-mono text-xs text-gray-600">{billing.stripeSubscriptionId ?? '-'}</dd>
          </dl>
        </Section>

        <Section title="共通LINE（共有の秘書アカウント）" href="/admin/shared-bot-access" hrefLabel="開通管理を開く">
          <dl className="px-5 py-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-gray-500">開通状態</dt>
            <dd>
              <AdminBadge variant={sharedBotVariant(sharedBot.status)}>{sharedBot.label}</AdminBadge>
            </dd>
            <dt className="text-gray-500">申込日時</dt>
            <dd className="text-gray-900">{formatDateTime(sharedBot.requestedAt)}</dd>
            <dt className="text-gray-500">開通日時</dt>
            <dd className="text-gray-900">{formatDateTime(sharedBot.grantedAt)}</dd>
            <dt className="text-gray-500">送信枠の状態</dt>
            <dd className="text-gray-900">
              {sharedBot.quotaState === 'ok' ? '正常' : sharedBot.quotaState === 'soft' ? '縮退中（上限に近い）' : '停止中（上限超過）'}
            </dd>
          </dl>
        </Section>
      </div>

      <Section title="チャット連携（LINE・Slack などのグループ）" count={detail.channelGroups.length}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className={TH}>チャット</th>
                <th className={TH}>グループ名</th>
                <th className={TH}>紐づくスペース</th>
                <th className={TH}>状態</th>
                <th className={TH}>参加日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detail.channelGroups.length === 0 && <EmptyRow colSpan={5} message="チャットのグループはまだ繋がっていません" />}
              {detail.channelGroups.map((g) => (
                <tr key={g.id} className="hover:bg-gray-50">
                  <td className={TD}>{g.channelLabel}</td>
                  <td className={TD}>
                    <span className="font-medium text-gray-900">{g.displayName}</span>
                  </td>
                  <td className={TD}>{g.spaceName ?? <span className="text-gray-400">未紐付け</span>}</td>
                  <td className={TD}>
                    <AdminBadge variant={g.status === 'active' ? 'success' : 'default'}>{g.statusLabel}</AdminBadge>
                  </td>
                  <td className={TD}>{formatDate(g.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="ツール連携（Google Tasks・Notion など）" count={detail.integrations.length}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className={TH}>サービス</th>
                <th className={TH}>単位</th>
                <th className={TH}>状態</th>
                <th className={TH}>取り込み</th>
                <th className={TH}>接続日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detail.integrations.length === 0 && <EmptyRow colSpan={5} message="ツール連携はまだありません" />}
              {detail.integrations.map((i) => (
                <tr key={i.id} className="hover:bg-gray-50">
                  <td className={TD}>
                    <span className="font-medium text-gray-900">{i.providerLabel}</span>
                  </td>
                  <td className={TD}>{i.ownerTypeLabel}</td>
                  <td className={TD}>
                    <AdminBadge variant={i.status === 'active' ? 'success' : i.status === 'expired' ? 'warning' : 'default'}>
                      {i.statusLabel}
                    </AdminBadge>
                  </td>
                  <td className={TD}>{i.importEnabled ? 'オン' : 'オフ'}</td>
                  <td className={TD}>{formatDate(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="最近の通知" count={detail.recentNotifications.length} href="/admin/notifications">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className={TH}>日時</th>
                <th className={TH}>種類</th>
                <th className={TH}>送り先</th>
                <th className={TH}>既読</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detail.recentNotifications.length === 0 && <EmptyRow colSpan={4} message="通知はまだありません" />}
              {detail.recentNotifications.map((n) => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className={TD}>{formatDateTime(n.createdAt)}</td>
                  <td className={TD}>
                    <span className="text-gray-900">{n.typeLabel}</span>
                    <span className="ml-2 font-mono text-[10px] text-gray-400" title={n.type}>{n.type}</span>
                  </td>
                  <td className={TD}>{n.channelLabel}</td>
                  <td className={TD}>
                    {n.isUnread ? <AdminBadge variant="warning">未読</AdminBadge> : <span className="text-gray-400">既読</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
