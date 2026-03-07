'use client'

import { useState, useEffect, useCallback } from 'react'
import { CurrencyJpy, Check, ArrowRight } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useTaskPricing } from '@/lib/hooks/useTaskPricing'

interface TaskPricingPanelProps {
  taskId: string
  orgId: string
  spaceId: string
  defaultMarginRate: number | null
}

function formatJpy(value: number | null | undefined): string {
  if (value == null) return '-'
  return `\u00A5${value.toLocaleString()}`
}

export function TaskPricingPanel({
  taskId,
  orgId,
  spaceId,
  defaultMarginRate,
}: TaskPricingPanelProps) {
  const { pricing, loading, upsert, saving } = useTaskPricing({ taskId, orgId, spaceId })

  const [costHours, setCostHours] = useState('')
  const [costUnitPrice, setCostUnitPrice] = useState('')
  const [marginRate, setMarginRate] = useState('')
  const [sellMode, setSellMode] = useState<'margin' | 'fixed'>('margin')
  const [sellTotal, setSellTotal] = useState('')

  // Initialize form from pricing data
  useEffect(() => {
    if (pricing) {
      setCostHours(pricing.cost_hours != null ? String(pricing.cost_hours) : '')
      setCostUnitPrice(pricing.cost_unit_price != null ? String(pricing.cost_unit_price) : '')
      setMarginRate(pricing.margin_rate != null ? String(pricing.margin_rate) : '')
      setSellMode(pricing.sell_mode)
      setSellTotal(pricing.sell_total != null ? String(pricing.sell_total) : '')
    } else if (defaultMarginRate != null) {
      setMarginRate(String(defaultMarginRate))
    }
  }, [pricing, defaultMarginRate])

  // Calculate derived values
  const costTotal = (() => {
    const h = parseFloat(costHours)
    const p = parseFloat(costUnitPrice)
    if (isNaN(h) || isNaN(p)) return null
    return h * p
  })()

  const calculatedSellTotal = (() => {
    if (sellMode === 'fixed') return parseFloat(sellTotal) || null
    if (costTotal == null) return null
    const m = parseFloat(marginRate)
    if (isNaN(m)) return null
    return Math.round(costTotal * (1 + m / 100))
  })()

  const profit = (() => {
    if (costTotal == null || calculatedSellTotal == null) return null
    return calculatedSellTotal - costTotal
  })()

  const handleSave = useCallback(async () => {
    try {
      await upsert({
        cost_hours: costHours ? parseFloat(costHours) : null,
        cost_unit_price: costUnitPrice ? parseFloat(costUnitPrice) : null,
        sell_mode: sellMode,
        margin_rate: marginRate ? parseFloat(marginRate) : null,
        sell_total: sellMode === 'fixed' ? (sellTotal ? parseFloat(sellTotal) : null) : calculatedSellTotal,
      })
      toast.success('価格設定を保存しました')
    } catch {
      toast.error('価格設定の保存に失敗しました')
    }
  }, [costHours, costUnitPrice, sellMode, marginRate, sellTotal, calculatedSellTotal, upsert])

  if (loading) {
    return (
      <div className="border border-gray-100 rounded-lg p-4 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
        <div className="space-y-2">
          <div className="h-8 bg-gray-50 rounded" />
          <div className="h-8 bg-gray-50 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="border border-gray-100 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <CurrencyJpy className="text-gray-500" size={16} />
        <span className="text-xs font-semibold text-gray-700">価格設定</span>
        {pricing?.vendor_submitted_at && (
          <span className="ml-auto text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
            見積もり提出済
          </span>
        )}
        {pricing?.agency_approved_at && (
          <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
            原価承認済
          </span>
        )}
        {pricing?.client_approved_at && (
          <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
            クライアント承認済
          </span>
        )}
      </div>

      {/* Cost section */}
      <div className="mb-4">
        <div className="text-[11px] font-medium text-gray-500 mb-2">原価</div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-gray-400">工数 (h)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={costHours}
              onChange={(e) => setCostHours(e.target.value)}
              placeholder="40"
              className="w-full mt-0.5 px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-300"
            />
          </div>
          <span className="text-gray-300 mt-4">x</span>
          <div className="flex-1">
            <label className="text-[10px] text-gray-400">単価 (円/h)</label>
            <input
              type="number"
              min="0"
              step="100"
              value={costUnitPrice}
              onChange={(e) => setCostUnitPrice(e.target.value)}
              placeholder="5,000"
              className="w-full mt-0.5 px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-300"
            />
          </div>
        </div>
        <div className="mt-1.5 text-xs text-gray-500">
          原価合計: <strong className="text-gray-700">{formatJpy(costTotal)}</strong>
        </div>
      </div>

      {/* Margin section */}
      <div className="mb-4 border-t border-gray-100 pt-3">
        <div className="text-[11px] font-medium text-gray-500 mb-2">マージン</div>
        <div className="flex items-center gap-3 mb-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input
              type="radio"
              name={`sellMode-${taskId}`}
              checked={sellMode === 'margin'}
              onChange={() => setSellMode('margin')}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            マージン率
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input
              type="radio"
              name={`sellMode-${taskId}`}
              checked={sellMode === 'fixed'}
              onChange={() => setSellMode('fixed')}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            固定売値
          </label>
        </div>

        {sellMode === 'margin' ? (
          <div className="flex items-center gap-2">
            <div className="w-24">
              <input
                type="number"
                min="0"
                max="999.99"
                step="0.01"
                value={marginRate}
                onChange={(e) => setMarginRate(e.target.value)}
                placeholder="35"
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>
            <span className="text-xs text-gray-400">%</span>
            <ArrowRight className="text-gray-300" size={12} />
            <span className="text-sm font-medium text-gray-700">
              {formatJpy(calculatedSellTotal)}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-32">
              <input
                type="number"
                min="0"
                value={sellTotal}
                onChange={(e) => setSellTotal(e.target.value)}
                placeholder="280,000"
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>
            <span className="text-xs text-gray-400">円</span>
          </div>
        )}
      </div>

      {/* Summary */}
      {costTotal != null && calculatedSellTotal != null && (
        <div className="border-t border-gray-100 pt-3 mb-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">売値合計</span>
            <span className="font-semibold text-gray-900">{formatJpy(calculatedSellTotal)}</span>
          </div>
          <div className="flex items-center justify-between text-xs mt-1">
            <span className="text-gray-500">利益</span>
            <span className={`font-medium ${profit != null && profit > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatJpy(profit)}
              {profit != null && costTotal > 0 && (
                <span className="ml-1 text-gray-400">
                  ({Math.round((profit / costTotal) * 100)}%)
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 rounded-md transition-colors"
      >
        <Check size={12} />
        {saving ? '保存中...' : '価格設定を保存'}
      </button>
    </div>
  )
}
