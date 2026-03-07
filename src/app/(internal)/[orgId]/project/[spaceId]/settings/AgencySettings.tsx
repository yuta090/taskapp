'use client'

import { useCallback, useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useAgencyMode, type VendorSettings } from '@/lib/hooks/useAgencyMode'

interface AgencySettingsProps {
  spaceId: string
}

function ToggleItem({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 py-3 px-1 cursor-pointer group">
      <div className="pt-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            checked ? 'bg-indigo-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      </div>
    </label>
  )
}

export function AgencySettings({ spaceId }: AgencySettingsProps) {
  const { data, loading, update } = useAgencyMode(spaceId)
  const [marginInput, setMarginInput] = useState('')

  useEffect(() => {
    if (data.default_margin_rate != null) {
      setMarginInput(String(data.default_margin_rate))
    }
  }, [data.default_margin_rate])

  const handleToggleAgencyMode = useCallback(
    async (checked: boolean) => {
      try {
        await update({ agency_mode: checked })
        toast.success(checked ? '代理店モードを有効にしました' : '代理店モードを無効にしました')
      } catch {
        toast.error('設定の更新に失敗しました')
      }
    },
    [update]
  )

  const handleMarginBlur = useCallback(async () => {
    const val = marginInput.trim()
    const num = val ? parseFloat(val) : null
    if (val && (isNaN(num!) || num! < 0 || num! > 999.99)) {
      toast.error('マージン率は 0〜999.99 の範囲で入力してください')
      return
    }
    if (num === data.default_margin_rate) return
    try {
      await update({ default_margin_rate: num })
      toast.success('デフォルトマージン率を更新しました')
    } catch {
      toast.error('設定の更新に失敗しました')
    }
  }, [marginInput, data.default_margin_rate, update])

  const handleVendorSetting = useCallback(
    async (key: keyof VendorSettings, checked: boolean) => {
      try {
        await update({ vendor_settings: { ...data.vendor_settings, [key]: checked } })
        toast.success('ベンダー設定を更新しました')
      } catch {
        toast.error('設定の更新に失敗しました')
      }
    },
    [data.vendor_settings, update]
  )

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-100 rounded w-1/3" />
        <div className="h-10 bg-gray-50 rounded" />
        <div className="h-10 bg-gray-50 rounded" />
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">代理店モード</h3>
      <p className="text-xs text-gray-500 mb-4">
        代理店として制作会社（ベンダー）とクライアントの間に立つ場合に有効にします。
        ベンダーポータル、マージン管理、3者間ボールが使えるようになります。
      </p>

      <div className="divide-y divide-gray-100">
        <ToggleItem
          label="代理店モードを有効にする"
          description="有効にすると、ベンダー招待・マージン管理・ベンダーポータルが利用可能になります"
          checked={data.agency_mode}
          onChange={handleToggleAgencyMode}
        />
      </div>

      {data.agency_mode && (
        <>
          {/* Margin Settings */}
          <div className="mt-6 border-t border-gray-100 pt-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">マージン設定</h4>
            <div className="flex items-center gap-2">
              <label htmlFor="margin-rate" className="text-sm text-gray-600 whitespace-nowrap">
                デフォルトマージン率
              </label>
              <div className="relative w-28">
                <input
                  id="margin-rate"
                  type="number"
                  min="0"
                  max="999.99"
                  step="0.01"
                  value={marginInput}
                  onChange={(e) => setMarginInput(e.target.value)}
                  onBlur={handleMarginBlur}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  placeholder="35"
                  className="w-full pr-7 pl-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              タスクごとに個別のマージン率を設定することもできます。
            </p>
          </div>

          {/* Vendor Settings */}
          <div className="mt-6 border-t border-gray-100 pt-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">ベンダーポータル設定</h4>
            <div className="divide-y divide-gray-100">
              <ToggleItem
                label="クライアント名をベンダーに表示"
                description="有効にすると、制作会社のベンダーポータルにエンドクライアントの名前が表示されます"
                checked={data.vendor_settings.show_client_name}
                onChange={(checked) => handleVendorSetting('show_client_name', checked)}
              />
              <ToggleItem
                label="ベンダーからクライアントへのコメントを許可"
                description="有効にすると、制作会社がクライアントに見えるコメントを投稿できます"
                checked={data.vendor_settings.allow_client_comments}
                onChange={(checked) => handleVendorSetting('allow_client_comments', checked)}
              />
            </div>
          </div>

          {/* Info box */}
          <div className="mt-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
            <p className="text-xs text-indigo-800">
              代理店モードが有効なスペースでは、メンバー設定から「ベンダー」ロールで制作会社を招待できます。
              ベンダーは専用のベンダーポータルからタスクの進捗報告・見積もり提出が可能です。
            </p>
          </div>
        </>
      )}
    </div>
  )
}
