'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import {
  FunnelSimple,
  Circle,
  User,
  Flag,
  CalendarBlank,
  Target,
  CaretRight,
  X,
  Check,
  ArrowRight,
  FileText,
} from '@phosphor-icons/react'
import type { TaskStatus, BallSide, TaskType, DecisionState, Milestone } from '@/types/database'

// Filter value types
export interface TaskFilters {
  status: TaskStatus[]
  ball: BallSide[]
  type: TaskType[]
  assigneeId: (string | null)[]  // null = 未割り当て
  milestoneId: (string | null)[] // null = マイルストーンなし
  priority: (number | null)[]    // null = 優先度なし
  dueDateRange: 'all' | 'has_date' | 'no_date' | 'overdue' | 'today' | 'this_week' | 'this_month'
  decisionState: (DecisionState | null)[]
}

export const defaultFilters: TaskFilters = {
  status: [],
  ball: [],
  type: [],
  assigneeId: [],
  milestoneId: [],
  priority: [],
  dueDateRange: 'all',
  decisionState: [],
}

interface Owner {
  user_id: string
  display_name: string | null
  side: 'client' | 'internal'
}

interface TaskFilterMenuProps {
  filters: TaskFilters
  onFiltersChange: (filters: TaskFilters) => void
  milestones: Milestone[]
  owners: Owner[]
}

// Filter options
const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'バックログ' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: '進行中' },
  { value: 'in_review', label: 'レビュー中' },
  { value: 'done', label: '完了' },
  { value: 'considering', label: '検討中' },
]

const BALL_OPTIONS: { value: BallSide; label: string }[] = [
  { value: 'internal', label: '社内' },
  { value: 'client', label: '外部' },
]

const TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'task', label: 'タスク' },
  { value: 'spec', label: '仕様' },
]

const PRIORITY_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '優先度なし' },
  { value: 1, label: '緊急' },
  { value: 2, label: '高' },
  { value: 3, label: '中' },
  { value: 4, label: '低' },
]

const DUE_DATE_OPTIONS: { value: TaskFilters['dueDateRange']; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'has_date', label: '期限あり' },
  { value: 'no_date', label: '期限なし' },
  { value: 'overdue', label: '期限超過' },
  { value: 'today', label: '今日まで' },
  { value: 'this_week', label: '今週まで' },
  { value: 'this_month', label: '今月まで' },
]

const DECISION_STATE_OPTIONS: { value: DecisionState | null; label: string }[] = [
  { value: null, label: '状態なし' },
  { value: 'considering', label: '検討中' },
  { value: 'decided', label: '決定' },
  { value: 'implemented', label: '実装済' },
]

type FilterCategory = 'status' | 'ball' | 'type' | 'assignee' | 'milestone' | 'priority' | 'dueDate' | 'decisionState'

const FILTER_CATEGORIES: { key: FilterCategory; label: string; icon: React.ReactNode }[] = [
  { key: 'status', label: 'ステータス', icon: <Circle className="text-base" /> },
  { key: 'ball', label: 'ボール', icon: <ArrowRight className="text-base" /> },
  { key: 'type', label: 'タイプ', icon: <FileText className="text-base" /> },
  { key: 'assignee', label: '担当者', icon: <User className="text-base" /> },
  { key: 'milestone', label: 'マイルストーン', icon: <Target className="text-base" /> },
  { key: 'priority', label: '優先度', icon: <Flag className="text-base" /> },
  { key: 'dueDate', label: '期限', icon: <CalendarBlank className="text-base" /> },
  { key: 'decisionState', label: '仕様状態', icon: <FileText className="text-base" /> },
]

export function TaskFilterMenu({ filters, onFiltersChange, milestones, owners }: TaskFilterMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Calculate active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.status.length > 0) count++
    if (filters.ball.length > 0) count++
    if (filters.type.length > 0) count++
    if (filters.assigneeId.length > 0) count++
    if (filters.milestoneId.length > 0) count++
    if (filters.priority.length > 0) count++
    if (filters.dueDateRange !== 'all') count++
    if (filters.decisionState.length > 0) count++
    return count
  }, [filters])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setActiveCategory(null)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleToggle = () => {
    setIsOpen(!isOpen)
    if (isOpen) {
      setActiveCategory(null)
    }
  }

  const clearAllFilters = () => {
    onFiltersChange(defaultFilters)
  }

  // Toggle array-based filter
  const toggleArrayFilter = <K extends keyof TaskFilters>(
    key: K,
    value: TaskFilters[K] extends (infer U)[] ? U : never
  ) => {
    const currentArray = filters[key] as unknown[]
    const newArray = currentArray.includes(value)
      ? currentArray.filter((v) => v !== value)
      : [...currentArray, value]
    onFiltersChange({ ...filters, [key]: newArray })
  }

  // Set single value filter
  const setSingleFilter = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  const renderSubMenu = () => {
    if (!activeCategory) return null

    switch (activeCategory) {
      case 'status':
        return (
          <div className="py-1">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleArrayFilter('status', option.value)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                  filters.status.includes(option.value) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'
                }`}>
                  {filters.status.includes(option.value) && <Check weight="bold" className="text-xs" />}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )

      case 'ball':
        return (
          <div className="py-1">
            {BALL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleArrayFilter('ball', option.value)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                  filters.ball.includes(option.value) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'
                }`}>
                  {filters.ball.includes(option.value) && <Check weight="bold" className="text-xs" />}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )

      case 'type':
        return (
          <div className="py-1">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleArrayFilter('type', option.value)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                  filters.type.includes(option.value) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'
                }`}>
                  {filters.type.includes(option.value) && <Check weight="bold" className="text-xs" />}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )

      case 'assignee':
        return (
          <div className="py-1 max-h-[300px] overflow-y-auto">
            <button
              type="button"
              onClick={() => toggleArrayFilter('assigneeId', null)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                filters.assigneeId.includes(null) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'
              }`}>
                {filters.assigneeId.includes(null) && <Check weight="bold" className="text-xs" />}
              </span>
              <span className="text-gray-500">未割り当て</span>
            </button>
            {owners.map((owner) => (
              <button
                key={owner.user_id}
                type="button"
                onClick={() => toggleArrayFilter('assigneeId', owner.user_id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                  filters.assigneeId.includes(owner.user_id) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'
                }`}>
                  {filters.assigneeId.includes(owner.user_id) && <Check weight="bold" className="text-xs" />}
                </span>
                <span>{owner.display_name || owner.user_id.slice(0, 8)}</span>
                {owner.side === 'client' && (
                  <span className="text-[10px] px-1 py-0.5 bg-amber-100 text-amber-600 rounded">外部</span>
                )}
              </button>
            ))}
          </div>
        )

      case 'milestone':
        return (
          <div className="py-1 max-h-[300px] overflow-y-auto">
            <button
              type="button"
              onClick={() => toggleArrayFilter('milestoneId', null)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                filters.milestoneId.includes(null) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'
              }`}>
                {filters.milestoneId.includes(null) && <Check weight="bold" className="text-xs" />}
              </span>
              <span className="text-gray-500">マイルストーンなし</span>
            </button>
            {milestones.map((milestone) => (
              <button
                key={milestone.id}
                type="button"
                onClick={() => toggleArrayFilter('milestoneId', milestone.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                  filters.milestoneId.includes(milestone.id) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'
                }`}>
                  {filters.milestoneId.includes(milestone.id) && <Check weight="bold" className="text-xs" />}
                </span>
                <span className="truncate">{milestone.name}</span>
              </button>
            ))}
          </div>
        )

      case 'priority':
        return (
          <div className="py-1">
            {PRIORITY_OPTIONS.map((option) => (
              <button
                key={option.value ?? 'null'}
                type="button"
                onClick={() => toggleArrayFilter('priority', option.value)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                  filters.priority.includes(option.value) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'
                }`}>
                  {filters.priority.includes(option.value) && <Check weight="bold" className="text-xs" />}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )

      case 'dueDate':
        return (
          <div className="py-1">
            {DUE_DATE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSingleFilter('dueDateRange', option.value)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors ${
                  filters.dueDateRange === option.value ? 'bg-blue-50 text-blue-600' : ''
                }`}
              >
                <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  filters.dueDateRange === option.value ? 'border-blue-500' : 'border-gray-300'
                }`}>
                  {filters.dueDateRange === option.value && (
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                  )}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )

      case 'decisionState':
        return (
          <div className="py-1">
            {DECISION_STATE_OPTIONS.map((option) => (
              <button
                key={option.value ?? 'null'}
                type="button"
                onClick={() => toggleArrayFilter('decisionState', option.value)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                  filters.decisionState.includes(option.value) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'
                }`}>
                  {filters.decisionState.includes(option.value) && <Check weight="bold" className="text-xs" />}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )

      default:
        return null
    }
  }

  const getCategorySelectionCount = (category: FilterCategory): number => {
    switch (category) {
      case 'status': return filters.status.length
      case 'ball': return filters.ball.length
      case 'type': return filters.type.length
      case 'assignee': return filters.assigneeId.length
      case 'milestone': return filters.milestoneId.length
      case 'priority': return filters.priority.length
      case 'dueDate': return filters.dueDateRange !== 'all' ? 1 : 0
      case 'decisionState': return filters.decisionState.length
      default: return 0
    }
  }

  return (
    <div ref={menuRef} className="relative">
      {/* Filter button */}
      <button
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors border ${
          activeFilterCount > 0
            ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
            : 'text-gray-600 hover:text-gray-900 border-gray-200 hover:border-gray-300 bg-white'
        }`}
      >
        <FunnelSimple weight={activeFilterCount > 0 ? 'fill' : 'regular'} className="text-sm" />
        <span>フィルター</span>
        {activeFilterCount > 0 && (
          <span className="ml-0.5 w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center">
            {activeFilterCount}
          </span>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 flex">
          {/* Main menu */}
          <div className="bg-white rounded-lg shadow-lg border border-gray-200 min-w-[200px]">
            {/* Clear all button */}
            {activeFilterCount > 0 && (
              <div className="px-3 py-2 border-b border-gray-100">
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-500 transition-colors"
                >
                  <X className="text-sm" />
                  フィルターをクリア
                </button>
              </div>
            )}

            {/* Category list */}
            <div className="py-1">
              {FILTER_CATEGORIES.map((category) => {
                const count = getCategorySelectionCount(category.key)
                return (
                  <button
                    key={category.key}
                    type="button"
                    onMouseEnter={() => setActiveCategory(category.key)}
                    onClick={() => setActiveCategory(category.key)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
                      activeCategory === category.key ? 'bg-gray-50' : ''
                    }`}
                  >
                    <span className="text-gray-500">{category.icon}</span>
                    <span className="flex-1 text-left">{category.label}</span>
                    {count > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded-full">
                        {count}
                      </span>
                    )}
                    <CaretRight className="text-xs text-gray-400" />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Sub menu */}
          {activeCategory && (
            <div className="bg-white rounded-lg shadow-lg border border-gray-200 ml-1 min-w-[180px]">
              {renderSubMenu()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Helper function to filter tasks based on filters
export function applyTaskFilters<T extends {
  status: TaskStatus
  ball: BallSide
  type: TaskType
  assignee_id: string | null
  milestone_id: string | null
  priority: number | null
  due_date: string | null
  decision_state: DecisionState | null
}>(
  tasks: T[],
  filters: TaskFilters
): T[] {
  return tasks.filter((task) => {
    // Status filter
    if (filters.status.length > 0 && !filters.status.includes(task.status)) {
      return false
    }

    // Ball filter
    if (filters.ball.length > 0 && !filters.ball.includes(task.ball)) {
      return false
    }

    // Type filter
    if (filters.type.length > 0 && !filters.type.includes(task.type)) {
      return false
    }

    // Assignee filter
    if (filters.assigneeId.length > 0 && !filters.assigneeId.includes(task.assignee_id)) {
      return false
    }

    // Milestone filter
    if (filters.milestoneId.length > 0 && !filters.milestoneId.includes(task.milestone_id)) {
      return false
    }

    // Priority filter
    if (filters.priority.length > 0 && !filters.priority.includes(task.priority)) {
      return false
    }

    // Due date filter
    if (filters.dueDateRange !== 'all') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      switch (filters.dueDateRange) {
        case 'has_date':
          if (!task.due_date) return false
          break
        case 'no_date':
          if (task.due_date) return false
          break
        case 'overdue':
          if (!task.due_date) return false
          const dueDate = new Date(task.due_date)
          dueDate.setHours(0, 0, 0, 0)
          if (dueDate >= today) return false
          break
        case 'today':
          if (!task.due_date) return false
          const todayDue = new Date(task.due_date)
          todayDue.setHours(0, 0, 0, 0)
          if (todayDue.getTime() !== today.getTime()) return false
          break
        case 'this_week': {
          if (!task.due_date) return false
          const weekEnd = new Date(today)
          weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()))
          const weekDue = new Date(task.due_date)
          weekDue.setHours(0, 0, 0, 0)
          if (weekDue < today || weekDue > weekEnd) return false
          break
        }
        case 'this_month': {
          if (!task.due_date) return false
          const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
          const monthDue = new Date(task.due_date)
          monthDue.setHours(0, 0, 0, 0)
          if (monthDue < today || monthDue > monthEnd) return false
          break
        }
      }
    }

    // Decision state filter
    if (filters.decisionState.length > 0 && !filters.decisionState.includes(task.decision_state)) {
      return false
    }

    return true
  })
}
