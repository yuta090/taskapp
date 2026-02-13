'use client'

import { useState, useRef, useEffect } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'

interface SetupGuideProps {
  defaultOpen?: boolean
  children: React.ReactNode
}

export function SetupGuide({ defaultOpen = false, children }: SetupGuideProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(
    defaultOpen ? undefined : 0
  )

  useEffect(() => {
    if (!contentRef.current) return
    if (isOpen) {
      setHeight(contentRef.current.scrollHeight)
      const timer = setTimeout(() => setHeight(undefined), 200)
      return () => clearTimeout(timer)
    } else {
      setHeight(contentRef.current.scrollHeight)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight(0))
      })
    }
  }, [isOpen])

  return (
    <div data-testid="setup-guide">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
        data-testid="setup-guide-toggle"
      >
        {isOpen ? (
          <CaretDown className="w-4 h-4" weight="bold" />
        ) : (
          <CaretRight className="w-4 h-4" weight="bold" />
        )}
        <span>セットアップガイド</span>
      </button>
      <div
        ref={contentRef}
        style={{ height: height !== undefined ? `${height}px` : 'auto' }}
        className="overflow-hidden transition-all duration-200 ease-in-out"
      >
        <div className="mt-2 p-4 bg-gray-50 rounded-lg border border-gray-100 text-sm text-gray-600 space-y-3">
          {children}
        </div>
      </div>
    </div>
  )
}
