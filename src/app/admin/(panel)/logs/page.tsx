'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminDataTable, type ColumnDef, matchesSearch, getNestedValue, compareValues } from '@/components/admin/AdminDataTable'
import { AdminJsonViewer } from '@/components/admin/AdminJsonViewer'

interface AuditLogRow {
  id: string
  event_type: string
  target_type: string
  target_id: string
  summary: string | null
  actor_id: string | null
  actor_role: string | null
  visibility: string | null
  occurred_at: string
  data_before: unknown
  data_after: unknown
}

interface TaskEventRow {
  id: string
  action: string
  task_id: string
  actor_id: string | null
  payload: unknown
  created_at: string
}

type DateRange = '24h' | '7d' | '30d' | 'all'

function getDateThreshold(range: DateRange): Date | null {
  if (range === 'all') return null
  const now = new Date()
  if (range === '24h') return new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (range === '7d') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
}

const auditColumns: ColumnDef<AuditLogRow>[] = [
  { key: 'occurred_at', label: '日時', sortable: true, width: '160px' },
  {
    key: 'event_type',
    label: 'イベント',
    sortable: true,
    render: (value) => <AdminBadge variant="info">{String(value)}</AdminBadge>,
  },
  { key: 'target_type', label: '対象', sortable: true },
  { key: 'summary', label: '概要', width: '300px' },
  {
    key: 'data_after',
    label: '変更後',
    width: '200px',
    render: (value) => (value ? <AdminJsonViewer data={value} /> : <span className="text-gray-300">-</span>),
  },
]

const eventColumns: ColumnDef<TaskEventRow>[] = [
  { key: 'created_at', label: '日時', sortable: true, width: '160px' },
  {
    key: 'action',
    label: 'アクション',
    sortable: true,
    render: (value) => <AdminBadge variant="default">{String(value)}</AdminBadge>,
  },
  { key: 'task_id', label: 'Task ID', sortable: true },
  {
    key: 'payload',
    label: 'ペイロード',
    width: '300px',
    render: (value) => <AdminJsonViewer data={value} />,
  },
]

export default function AdminLogsPage() {
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([])
  const [taskEvents, setTaskEvents] = useState<TaskEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [auditSearch, setAuditSearch] = useState('')
  const [eventSearch, setEventSearch] = useState('')
  const [auditPage, setAuditPage] = useState(1)
  const [eventPage, setEventPage] = useState(1)
  const [auditPageSize, setAuditPageSize] = useState(25)
  const [eventPageSize, setEventPageSize] = useState(25)
  const [auditSortKey, setAuditSortKey] = useState<string | null>(null)
  const [auditSortDir, setAuditSortDir] = useState<'asc' | 'desc' | null>(null)
  const [eventSortKey, setEventSortKey] = useState<string | null>(null)
  const [eventSortDir, setEventSortDir] = useState<'asc' | 'desc' | null>(null)

  const handleAuditSortChange = useCallback((key: string, dir: 'asc' | 'desc' | null) => {
    setAuditSortKey(key)
    setAuditSortDir(dir)
  }, [])

  const handleEventSortChange = useCallback((key: string, dir: 'asc' | 'desc' | null) => {
    setEventSortKey(key)
    setEventSortDir(dir)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      const client = supabase as SupabaseClient
      const [logsResult, eventsResult] = await Promise.all([
        client
          .from('audit_logs')
          .select('id, event_type, target_type, target_id, summary, actor_id, actor_role, visibility, occurred_at, data_before, data_after')
          .order('occurred_at', { ascending: false })
          .limit(500),
        client
          .from('task_events')
          .select('id, action, task_id, actor_id, payload, created_at')
          .order('created_at', { ascending: false })
          .limit(200),
      ])
      if (cancelled) return

      const queryError = logsResult.error ?? eventsResult.error
      if (queryError) {
        setError(queryError.message)
        setLoading(false)
        return
      }

      if (!cancelled) {
        setAuditLogs((logsResult.data as AuditLogRow[]) ?? [])
        setTaskEvents((eventsResult.data as TaskEventRow[]) ?? [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const eventTypes = useMemo(() => {
    const types = new Set<string>()
    for (const log of auditLogs) {
      if (log.event_type) types.add(log.event_type)
    }
    return Array.from(types).sort()
  }, [auditLogs])

  const filteredAuditLogs = useMemo(() => {
    const threshold = getDateThreshold(dateRange)
    let result = auditLogs.filter((log) => {
      if (threshold && new Date(log.occurred_at) < threshold) return false
      if (eventTypeFilter && log.event_type !== eventTypeFilter) return false
      return true
    })
    const query = auditSearch.trim()
    if (query) {
      result = result.filter((r) => matchesSearch(r as unknown as Record<string, unknown>, query))
    }
    return result
  }, [auditLogs, dateRange, eventTypeFilter, auditSearch])

  const sortedAuditLogs = useMemo(() => {
    if (!auditSortKey || !auditSortDir) return filteredAuditLogs
    const arr = [...filteredAuditLogs]
    arr.sort((a, b) => {
      const va = getNestedValue(a as unknown as Record<string, unknown>, auditSortKey)
      const vb = getNestedValue(b as unknown as Record<string, unknown>, auditSortKey)
      const cmp = compareValues(va, vb)
      return auditSortDir === 'desc' ? -cmp : cmp
    })
    return arr
  }, [filteredAuditLogs, auditSortKey, auditSortDir])

  const filteredTaskEvents = useMemo(() => {
    const threshold = getDateThreshold(dateRange)
    let result = taskEvents.filter((evt) => {
      if (threshold && new Date(evt.created_at) < threshold) return false
      return true
    })
    const query = eventSearch.trim()
    if (query) {
      result = result.filter((r) => matchesSearch(r as unknown as Record<string, unknown>, query))
    }
    return result
  }, [taskEvents, dateRange, eventSearch])

  const sortedTaskEvents = useMemo(() => {
    if (!eventSortKey || !eventSortDir) return filteredTaskEvents
    const arr = [...filteredTaskEvents]
    arr.sort((a, b) => {
      const va = getNestedValue(a as unknown as Record<string, unknown>, eventSortKey)
      const vb = getNestedValue(b as unknown as Record<string, unknown>, eventSortKey)
      const cmp = compareValues(va, vb)
      return eventSortDir === 'desc' ? -cmp : cmp
    })
    return arr
  }, [filteredTaskEvents, eventSortKey, eventSortDir])

  const pagedAuditLogs = useMemo(() => {
    const start = (auditPage - 1) * auditPageSize
    return sortedAuditLogs.slice(start, start + auditPageSize)
  }, [sortedAuditLogs, auditPage, auditPageSize])

  const pagedTaskEvents = useMemo(() => {
    const start = (eventPage - 1) * eventPageSize
    return sortedTaskEvents.slice(start, start + eventPageSize)
  }, [sortedTaskEvents, eventPage, eventPageSize])

  const handleDateRangeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setDateRange(e.target.value as DateRange)
    setAuditPage(1)
    setEventPage(1)
  }, [])

  const handleEventTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setEventTypeFilter(e.target.value)
    setAuditPage(1)
  }, [])

  const handleAuditSearchChange = useCallback((value: string) => {
    setAuditSearch(value)
    setAuditPage(1)
  }, [])

  const handleEventSearchChange = useCallback((value: string) => {
    setEventSearch(value)
    setEventPage(1)
  }, [])

  const handleAuditPageSizeChange = useCallback((size: number) => {
    setAuditPageSize(size)
    setAuditPage(1)
  }, [])

  const handleEventPageSizeChange = useCallback((size: number) => {
    setEventPageSize(size)
    setEventPage(1)
  }, [])

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title="ログビューア"
        description="監査ログ・タスクイベント"
      />

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={dateRange}
          onChange={handleDateRangeChange}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="24h">直近24時間</option>
          <option value="7d">直近7日</option>
          <option value="30d">直近30日</option>
          <option value="all">すべて</option>
        </select>
        <select
          value={eventTypeFilter}
          onChange={handleEventTypeChange}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">イベントタイプ: すべて</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Audit Logs */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">
        監査ログ ({filteredAuditLogs.length}件)
      </h2>
      <div className="mb-8">
        <AdminDataTable<AuditLogRow>
          columns={auditColumns}
          data={pagedAuditLogs}
          total={sortedAuditLogs.length}
          page={auditPage}
          pageSize={auditPageSize}
          onPageChange={setAuditPage}
          onPageSizeChange={handleAuditPageSizeChange}
          searchValue={auditSearch}
          onSearchChange={handleAuditSearchChange}
          loading={loading}
          emptyMessage="ログがありません"
          tableName="audit_logs"
          sortKey={auditSortKey}
          sortDirection={auditSortDir}
          onSortChange={handleAuditSortChange}
          allData={sortedAuditLogs}
        />
      </div>

      {/* Task Events */}
      <h2 className="text-sm font-medium text-gray-700 mb-3">
        タスクイベント ({filteredTaskEvents.length}件)
      </h2>
      <AdminDataTable<TaskEventRow>
        columns={eventColumns}
        data={pagedTaskEvents}
        total={sortedTaskEvents.length}
        page={eventPage}
        pageSize={eventPageSize}
        onPageChange={setEventPage}
        onPageSizeChange={handleEventPageSizeChange}
        searchValue={eventSearch}
        onSearchChange={handleEventSearchChange}
        loading={loading}
        emptyMessage="イベントがありません"
        tableName="task_events"
        sortKey={eventSortKey}
        sortDirection={eventSortDir}
        onSortChange={handleEventSortChange}
        allData={sortedTaskEvents}
      />
    </div>
  )
}
