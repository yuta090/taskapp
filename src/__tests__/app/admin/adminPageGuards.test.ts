import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 運営の画面(admin/(panel)/*)は、(panel) layout の門番に加えて、各ページ自身でも
 * verifySuperadmin を確認し、満たさなければ /admin/login へ redirect してから
 * データを読む（認可はデータ源の近くで・analytics・organizations/[id]・users と
 * 同じ形）。この形を15枚まとめて確かめる。
 */

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super('NEXT_REDIRECT')
  }
}

class DataAccessedBeforeGuardSignal extends Error {
  constructor() {
    super('createAdminClient was called before the superadmin check')
  }
}

let verifySuperadminResult: string | null = null

const redirectMock = vi.fn((destination: string) => {
  throw new RedirectSignal(destination)
})
const notFoundMock = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (destination: string) => redirectMock(destination),
  notFound: () => notFoundMock(),
}))

const verifySuperadminMock = vi.fn(() => Promise.resolve(verifySuperadminResult))
vi.mock('@/lib/admin/verify-superadmin', () => ({
  verifySuperadmin: () => verifySuperadminMock(),
}))

const createAdminClientMock = vi.fn(() => {
  throw new DataAccessedBeforeGuardSignal()
})
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

const { default: AnnouncementsPage } = await import('@/app/admin/(panel)/announcements/page')
const { default: ApiKeysPage } = await import('@/app/admin/(panel)/api-keys/page')
const { default: BillingPage } = await import('@/app/admin/(panel)/billing/page')
const { default: BlogEditorPage } = await import('@/app/admin/(panel)/blog/[id]/page')
const { default: BlogCtaPage } = await import('@/app/admin/(panel)/blog/cta/page')
const { default: BlogListPage } = await import('@/app/admin/(panel)/blog/page')
const { default: CliUsagePage } = await import('@/app/admin/(panel)/cli-usage/page')
const { default: DashboardPage } = await import('@/app/admin/(panel)/dashboard/page')
const { default: InvitesPage } = await import('@/app/admin/(panel)/invites/page')
const { default: LogsPage } = await import('@/app/admin/(panel)/logs/page')
const { default: NotificationsPage } = await import('@/app/admin/(panel)/notifications/page')
const { default: OrganizationsPage } = await import('@/app/admin/(panel)/organizations/page')
const { default: ReviewsPage } = await import('@/app/admin/(panel)/reviews/page')
const { default: SpacesPage } = await import('@/app/admin/(panel)/spaces/page')
const { default: TablesPage } = await import('@/app/admin/(panel)/tables/page')

const PAGES: Array<{ name: string; call: () => Promise<unknown> }> = [
  { name: 'announcements', call: () => AnnouncementsPage() },
  { name: 'api-keys', call: () => ApiKeysPage() },
  { name: 'billing', call: () => BillingPage() },
  { name: 'blog/[id]', call: () => BlogEditorPage({ params: Promise.resolve({ id: 'new' }) }) },
  { name: 'blog/cta', call: () => BlogCtaPage() },
  { name: 'blog', call: () => BlogListPage() },
  { name: 'cli-usage', call: () => CliUsagePage() },
  { name: 'dashboard', call: () => DashboardPage() },
  { name: 'invites', call: () => InvitesPage() },
  { name: 'logs', call: () => LogsPage() },
  { name: 'notifications', call: () => NotificationsPage() },
  { name: 'organizations', call: () => OrganizationsPage() },
  { name: 'reviews', call: () => ReviewsPage() },
  { name: 'spaces', call: () => SpacesPage() },
  { name: 'tables', call: () => TablesPage() },
]

describe.each(PAGES)('運営の画面ガード — $name', ({ call }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifySuperadminResult = null
  })

  it('verifySuperadmin が null を返したら /admin/login へ redirect し、データを読まない', async () => {
    await expect(call()).rejects.toBeInstanceOf(RedirectSignal)
    expect(redirectMock).toHaveBeenCalledWith('/admin/login')
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })
})
