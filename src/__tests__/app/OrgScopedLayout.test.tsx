import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'
import OrgScopedLayout from '@/app/(internal)/[orgId]/layout'

let mockParams: Record<string, string> = {}
vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
}))

function renderWithOrg(value: Partial<ActiveOrgContextValue>) {
  const full: ActiveOrgContextValue = {
    activeOrgId: null,
    activeOrgName: null,
    activeOrgRole: null,
    orgs: [],
    orgsStatus: 'verified',
    orgsRefreshFailed: false,
    loading: false,
    switchOrg: vi.fn(),
    ...value,
  }
  return render(
    <ActiveOrgContext.Provider value={full}>
      <OrgScopedLayout>
        <div>子コンテンツ</div>
      </OrgScopedLayout>
    </ActiveOrgContext.Provider>
  )
}

beforeEach(() => {
  mockParams = {}
})

describe('OrgScopedLayout（所属外org URLガード）', () => {
  it('ロード中（orgsStatus: unknown）は誤ブロックせず children を出す', () => {
    mockParams = { orgId: 'org-B' }
    renderWithOrg({
      orgsStatus: 'unknown',
      orgs: [{ orgId: 'org-A', orgName: 'A', role: 'owner' }],
    })
    expect(screen.getByText('子コンテンツ')).toBeInTheDocument()
    expect(screen.queryByText('この組織へのアクセス権がありません')).not.toBeInTheDocument()
  })

  it('所属orgのURLなら children を出す', () => {
    mockParams = { orgId: 'org-A' }
    renderWithOrg({ orgsStatus: 'verified', orgs: [{ orgId: 'org-A', orgName: 'A', role: 'owner' }] })
    expect(screen.getByText('子コンテンツ')).toBeInTheDocument()
  })

  it('所属外orgのURLなら403を出し、children を出さない', () => {
    mockParams = { orgId: 'org-B' }
    renderWithOrg({ orgsStatus: 'verified', orgs: [{ orgId: 'org-A', orgName: 'A', role: 'owner' }] })
    expect(screen.getByText('この組織へのアクセス権がありません')).toBeInTheDocument()
    expect(screen.queryByText('子コンテンツ')).not.toBeInTheDocument()
  })

  it('所属orgが空（未取得/無所属）なら誤ブロックしない', () => {
    mockParams = { orgId: 'org-B' }
    renderWithOrg({ orgsStatus: 'verified', orgs: [] })
    expect(screen.getByText('子コンテンツ')).toBeInTheDocument()
  })

  it('orgsStatus: cached（永続キャッシュ復元のみ・まだネットワーク確認前）で URL の org が一覧に無くても誤ブロックしない', () => {
    mockParams = { orgId: 'org-B' }
    renderWithOrg({
      orgsStatus: 'cached',
      orgs: [{ orgId: 'org-A', orgName: 'A', role: 'owner' }],
    })
    expect(screen.getByText('子コンテンツ')).toBeInTheDocument()
    expect(screen.queryByText('この組織へのアクセス権がありません')).not.toBeInTheDocument()
  })

  it('orgsStatus: verified（ネットワーク確認済み）で URL の org が一覧に無ければ403', () => {
    mockParams = { orgId: 'org-B' }
    renderWithOrg({
      orgsStatus: 'verified',
      orgs: [{ orgId: 'org-A', orgName: 'A', role: 'owner' }],
    })
    expect(screen.getByText('この組織へのアクセス権がありません')).toBeInTheDocument()
    expect(screen.queryByText('子コンテンツ')).not.toBeInTheDocument()
  })

  // 【N3】招待受諾などで所属が増えた直後、['orgMemberships'] の取り直しが失敗すると
  // （リトライも尽きて）、verified のまま古い一覧（新しい org を含まない）を出し続ける
  // （H1: activeOrgId を後退させないための意図した挙動）。このとき新しい org の URL に
  // 遷移すると、実際には所属しているのに「取り直しに失敗しただけ」で 403 を誤表示してしまう
  it('orgsRefreshFailed: true（直近の取り直しが失敗）なら、一覧に無くても誤ブロックしない', () => {
    mockParams = { orgId: 'org-B' }
    renderWithOrg({
      orgsStatus: 'verified',
      orgsRefreshFailed: true,
      orgs: [{ orgId: 'org-A', orgName: 'A', role: 'owner' }],
    })
    expect(screen.getByText('子コンテンツ')).toBeInTheDocument()
    expect(screen.queryByText('この組織へのアクセス権がありません')).not.toBeInTheDocument()
  })

  it('取り直しが成功しても（orgsRefreshFailed: false）一覧に無ければ403に戻る', () => {
    mockParams = { orgId: 'org-B' }
    renderWithOrg({
      orgsStatus: 'verified',
      orgsRefreshFailed: false,
      orgs: [{ orgId: 'org-A', orgName: 'A', role: 'owner' }],
    })
    expect(screen.getByText('この組織へのアクセス権がありません')).toBeInTheDocument()
    expect(screen.queryByText('子コンテンツ')).not.toBeInTheDocument()
  })
})
