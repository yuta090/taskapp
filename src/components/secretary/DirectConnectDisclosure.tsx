'use client'

import { useState } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import { ClientLinkPanel } from '@/components/secretary/ClientLinkPanel'
import { Hint } from '@/components/secretary/Hint'

/**
 * 「相手と1対1でつなぐ（Pro）」の控えめな副導線。
 *
 * 主役はグループLINE（1画面の主カード）。1対1の個別つなぎは、グループを介さず
 * 相手の担当者へ直接連絡したいとき用の Pro 機能（line_direct_dm は Pro 専有）なので、
 * グループカードの下に畳んで置く。既定は閉じており、必要な人だけ開いて使う。
 * 中身は既存の ClientLinkPanel をそのまま呼ぶだけ（identity・APIは不変）。
 */
export function DirectConnectDisclosure({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      {/* Hint はトグルの *外側* に置く（buttonの入れ子はHTML的に不正で、クリックも競合する） */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="direct-connect-toggle"
          className="flex items-center gap-1.5 text-left text-xs font-medium text-gray-600 hover:text-gray-900"
        >
          {open ? <CaretDown className="h-3.5 w-3.5" /> : <CaretRight className="h-3.5 w-3.5" />}
          <span>相手と1対1でつなぐ</span>
          <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
            Pro
          </span>
        </button>
        <Hint label="1対1でつなぐ">
          グループを使わず、相手の担当者へ直接つなぎたいときに使います。Proプランの機能です。
        </Hint>
      </div>
      {open && (
        <div className="mt-3 pl-5">
          <ClientLinkPanel orgId={orgId} />
        </div>
      )}
    </div>
  )
}
