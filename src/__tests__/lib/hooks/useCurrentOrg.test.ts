import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCurrentOrg } from '@/lib/hooks/useCurrentOrg'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

// `useCurrentOrg` is a thin selector over `ActiveOrgContext` (populated by
// `ActiveOrgProvider`, which owns the actual Supabase org-membership fetch).
// These tests exercise the selector's mapping from context -> hook return value.
function createWrapper(value: Partial<ActiveOrgContextValue>) {
  const fullValue: ActiveOrgContextValue = {
    activeOrgId: null,
    activeOrgName: null,
    activeOrgRole: null,
    orgs: [],
    switchOrg: () => {},
    loading: true,
    ...value,
  }

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(ActiveOrgContext.Provider, { value: fullValue }, children)
  }
}

describe('useCurrentOrg', () => {
  it('should start with loading state', () => {
    const { result } = renderHook(() => useCurrentOrg(), {
      wrapper: createWrapper({ loading: true }),
    })

    expect(result.current.loading).toBe(true)
    expect(result.current.orgId).toBe(null)
    expect(result.current.error).toBe(null)
  })

  it('should return org info when context has an active org', () => {
    const { result } = renderHook(() => useCurrentOrg(), {
      wrapper: createWrapper({
        loading: false,
        activeOrgId: 'org-456',
        activeOrgName: 'Test Organization',
        activeOrgRole: 'owner',
      }),
    })

    expect(result.current.orgId).toBe('org-456')
    expect(result.current.orgName).toBe('Test Organization')
    expect(result.current.role).toBe('owner')
    expect(result.current.error).toBe(null)
  })

  it('should return null orgId when context has no active org (e.g. not logged in)', () => {
    const { result } = renderHook(() => useCurrentOrg(), {
      wrapper: createWrapper({
        loading: false,
        activeOrgId: null,
        activeOrgName: null,
        activeOrgRole: null,
      }),
    })

    expect(result.current.orgId).toBe(null)
    expect(result.current.orgName).toBe(null)
    expect(result.current.role).toBe(null)
    expect(result.current.error).toBe(null)
  })

  it('should return null orgId when context has no org membership', () => {
    const { result } = renderHook(() => useCurrentOrg(), {
      wrapper: createWrapper({
        loading: false,
        activeOrgId: null,
        orgs: [],
      }),
    })

    expect(result.current.orgId).toBe(null)
    expect(result.current.error).toBe(null)
  })

  it('should always report error as null (org-fetch errors are handled by ActiveOrgProvider)', () => {
    const { result } = renderHook(() => useCurrentOrg(), {
      wrapper: createWrapper({ loading: false }),
    })

    expect(result.current.error).toBe(null)
  })

  it('should handle different roles correctly', () => {
    const { result } = renderHook(() => useCurrentOrg(), {
      wrapper: createWrapper({
        loading: false,
        activeOrgId: 'org-456',
        activeOrgName: 'Test Organization',
        activeOrgRole: 'member',
      }),
    })

    expect(result.current.role).toBe('member')
  })

  it('should reflect a different active org when context value changes', () => {
    const { result: result1 } = renderHook(() => useCurrentOrg(), {
      wrapper: createWrapper({
        loading: false,
        activeOrgId: 'org-1',
        activeOrgName: 'Org One',
        activeOrgRole: 'owner',
      }),
    })
    expect(result1.current.orgId).toBe('org-1')

    const { result: result2 } = renderHook(() => useCurrentOrg(), {
      wrapper: createWrapper({
        loading: false,
        activeOrgId: 'org-2',
        activeOrgName: 'Org Two',
        activeOrgRole: 'member',
      }),
    })
    expect(result2.current.orgId).toBe('org-2')
    expect(result2.current.role).toBe('member')
  })
})
