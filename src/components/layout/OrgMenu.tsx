'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  GearSix,
  Users,
  CreditCard,
  SignOut,
} from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'

interface OrgMenuProps {
  isOpen: boolean
  onClose: () => void
  collapsed?: boolean
}

export function OrgMenu({ isOpen, onClose, collapsed }: OrgMenuProps) {
  const router = useRouter()
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleLogout = useCallback(async () => {
    const supabase = supabaseRef.current!
    await supabase.auth.signOut()
    router.push('/login')
  }, [router])

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="menu"
        aria-orientation="vertical"
        className={`absolute top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-popover py-1.5 z-50 ${
          collapsed ? 'left-0 w-56' : 'left-3 right-3'
        }`}
      >
        <Link
          href="/settings/organization"
          onClick={onClose}
          role="menuitem"
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <GearSix className="text-base text-gray-500" />
          組織設定
        </Link>
        <Link
          href="/settings/members"
          onClick={onClose}
          role="menuitem"
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Users className="text-base text-gray-500" />
          メンバー管理
        </Link>
        <Link
          href="/settings/billing"
          onClick={onClose}
          role="menuitem"
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <CreditCard className="text-base text-gray-500" />
          プラン・お支払い
        </Link>
        <hr className="my-1.5 border-gray-100" role="separator" />
        <button
          type="button"
          onClick={handleLogout}
          role="menuitem"
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
        >
          <SignOut className="text-base" />
          ログアウト
        </button>
      </div>
    </>
  )
}
