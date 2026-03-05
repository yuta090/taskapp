'use client'

export interface FilterOption {
  label: string
  value: string
}

export interface FilterDef {
  key: string
  label: string
  options: FilterOption[]
}

interface AdminFilterBarProps {
  filters: FilterDef[]
  activeFilters: Record<string, string>
  onFilterChange: (key: string, value: string) => void
}

export function AdminFilterBar({ filters, activeFilters, onFilterChange }: AdminFilterBarProps) {
  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      {filters.map((f) => (
        <div key={f.key} className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">{f.label}</label>
          <select
            value={activeFilters[f.key] ?? ''}
            onChange={(e) => onFilterChange(f.key, e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="">すべて</option>
            {f.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}
