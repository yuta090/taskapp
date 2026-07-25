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
  it('ロード中は誤ブロックせず children を出す', () => {
    mockParams = { orgId: 'org-B' }
    renderWithOrg({ loading: true, orgs: [{ orgId: 'org-A', orgName: 'A', role: 'owner' }] })
    expect(screen.getByText('子コンテンツ')).toBeInTheDocument()
    expect(screen.queryByText('この組織へのアクセス権がありません')).not.toBeInTheDocument()
  })

  it('所属orgのURLなら children を出す', () => {
    mockParams = { orgId: 'org-A' }
    renderWithOrg({ loading: false, orgs: [{ orgId: 'org-A', orgName: 'A', role: 'owner' }] })
    expect(screen.getByText('子コンテンツ')).toBeInTheDocument()
  })

  it('所属外orgのURLなら403を出し、children を出さない', () => {
    mockParams = { orgId: 'org-B' }
    renderWithOrg({ loading: false, orgs: [{ orgId: 'org-A', orgName: 'A', role: 'owner' }] })
    expect(screen.getByText('この組織へのアクセス権がありません')).toBeInTheDocument()
    expect(screen.queryByText('子コンテンツ')).not.toBeInTheDocument()
  })

  it('所属orgが空（未取得/無所属）なら誤ブロックしない', () => {
    mockParams = { orgId: 'org-B' }
    renderWithOrg({ loading: false, orgs: [] })
    expect(screen.getByText('子コンテンツ')).toBeInTheDocument()
  })
})
