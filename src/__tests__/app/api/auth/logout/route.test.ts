import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/auth/logout/route'

const mockSignOut = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      signOut: mockSignOut,
    },
  }),
}))

function makeRequest(origin: string): NextRequest {
  return new NextRequest(`${origin}/api/auth/logout`, { method: 'POST' })
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignOut.mockResolvedValue({ error: null })
  })

  it('303 でログインへリダイレクトする（307だとPOSTのままログインに再送されうる）', async () => {
    const response = await POST(makeRequest('https://app.example.com'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://app.example.com/login')
  })

  it('リクエストのoriginを使う（NEXT_PUBLIC_APP_URL未設定でlocalhostに落ちない）', async () => {
    const response = await POST(makeRequest('https://taskapp.example.com'))

    expect(response.headers.get('location')).toBe('https://taskapp.example.com/login')
  })

  it('signOut を呼び出す', async () => {
    await POST(makeRequest('https://app.example.com'))

    expect(mockSignOut).toHaveBeenCalled()
  })
})
