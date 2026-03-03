'use client'

import { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react'
import { useRouter } from 'next/navigation'
import { MagnifyingGlass, Target, Tray, User, Gear } from '@phosphor-icons/react'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  action: () => void
  category: string
}

export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const close = useCallback(() => setIsOpen(false), [])

  const CommandPaletteUI = isOpen ? <CommandPaletteDialog onClose={close} /> : null

  return { CommandPalette: CommandPaletteUI }
}

function CommandPaletteDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { spaces } = useUserSpaces()
  const { activeOrgId } = useContext(ActiveOrgContext)

  // Focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const navigate = useCallback(
    (path: string) => {
      router.push(path)
      onClose()
    },
    [router, onClose],
  )

  // Build command items
  const items: CommandItem[] = useMemo(() => {
    const pageItems: CommandItem[] = [
      {
        id: 'inbox',
        label: '受信箱',
        description: '通知と受信トレイ',
        icon: <Tray className="text-base" />,
        action: () => navigate('/inbox'),
        category: 'ページ',
      },
      {
        id: 'my',
        label: 'マイタスク',
        description: '自分に割り当てられたタスク',
        icon: <User className="text-base" />,
        action: () => navigate('/my'),
        category: 'ページ',
      },
    ]

    const spaceItems: CommandItem[] = spaces.map((space) => ({
      id: `space-${space.id}`,
      label: space.name,
      description: space.orgName,
      icon: <Target className="text-base" />,
      action: () => navigate(`/${space.orgId}/project/${space.id}`),
      category: 'プロジェクト',
    }))

    // Add settings for current org spaces
    const settingsItems: CommandItem[] = activeOrgId
      ? spaces
          .filter((s) => s.orgId === activeOrgId)
          .map((space) => ({
            id: `settings-${space.id}`,
            label: `${space.name} の設定`,
            icon: <Gear className="text-base" />,
            action: () => navigate(`/${space.orgId}/project/${space.id}/settings`),
            category: '設定',
          }))
      : []

    return [...pageItems, ...spaceItems, ...settingsItems]
  }, [spaces, activeOrgId, navigate])

  // Filter items
  const filteredItems = useMemo(() => {
    if (!query.trim()) return items
    const q = query.toLowerCase()
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    )
  }, [items, query])

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Group items by category
  const groupedItems = useMemo(() => {
    const groups: { category: string; items: (CommandItem & { globalIndex: number })[] }[] = []
    let globalIndex = 0
    const categoryMap = new Map<string, (CommandItem & { globalIndex: number })[]>()

    for (const item of filteredItems) {
      if (!categoryMap.has(item.category)) {
        const arr: (CommandItem & { globalIndex: number })[] = []
        categoryMap.set(item.category, arr)
        groups.push({ category: item.category, items: arr })
      }
      categoryMap.get(item.category)!.push({ ...item, globalIndex })
      globalIndex++
    }

    return groups
  }, [filteredItems])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        filteredItems[selectedIndex]?.action()
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [filteredItems, selectedIndex, onClose],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-black/30 animate-backdrop-in" onClick={onClose} />
      <div
        className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl animate-dialog-in overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <MagnifyingGlass className="text-gray-400 text-lg flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ページやプロジェクトを検索..."
            className="flex-1 text-sm text-gray-900 placeholder:text-gray-400 outline-none bg-transparent"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-gray-100 border border-gray-200 rounded text-gray-400">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-2">
          {filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              該当する項目がありません
            </div>
          ) : (
            groupedItems.map((group) => (
              <div key={group.category}>
                <div className="px-4 py-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                  {group.category}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-index={item.globalIndex}
                    onClick={() => item.action()}
                    onMouseEnter={() => setSelectedIndex(item.globalIndex)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                      selectedIndex === item.globalIndex
                        ? 'bg-blue-50 text-blue-900'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span
                      className={`flex-shrink-0 ${
                        selectedIndex === item.globalIndex ? 'text-blue-500' : 'text-gray-400'
                      }`}
                    >
                      {item.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm truncate block">{item.label}</span>
                      {item.description && (
                        <span className="text-[11px] text-gray-400 truncate block">
                          {item.description}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 font-mono bg-gray-100 border border-gray-200 rounded">↑↓</kbd>
            移動
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 font-mono bg-gray-100 border border-gray-200 rounded">↵</kbd>
            選択
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 font-mono bg-gray-100 border border-gray-200 rounded">esc</kbd>
            閉じる
          </span>
        </div>
      </div>
    </div>
  )
}
