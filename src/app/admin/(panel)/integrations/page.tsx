'use client'

import { useState } from 'react'
import {
  GithubLogo,
  ChatCircleDots,
  CalendarCheck,
  VideoCamera,
  MicrosoftTeamsLogo,
  FloppyDisk,
  Trash,
  Eye,
  EyeSlash,
  CircleNotch,
  CheckCircle,
  XCircle,
  Warning,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  useSystemIntegrations,
  useSaveSystemIntegration,
  useDeleteSystemIntegration,
} from '@/lib/hooks/useSystemIntegrations'

type ProviderKey = 'github' | 'slack' | 'google_calendar' | 'zoom' | 'teams'

interface FieldDef {
  key: string
  label: string
  placeholder: string
  multiline?: boolean
}

interface ProviderDef {
  key: ProviderKey
  label: string
  icon: React.ElementType
  iconColor: string
  credentialFields: FieldDef[]
  configFields?: FieldDef[]
}

const PROVIDERS: ProviderDef[] = [
  {
    key: 'github',
    label: 'GitHub',
    icon: GithubLogo,
    iconColor: 'text-gray-800',
    credentialFields: [
      { key: 'app_id', label: 'App ID', placeholder: '123456' },
      { key: 'client_id', label: 'Client ID', placeholder: 'Iv1.xxxxxx' },
      { key: 'client_secret', label: 'Client Secret', placeholder: '' },
      { key: 'private_key', label: 'Private Key (PEM)', placeholder: '-----BEGIN RSA PRIVATE KEY-----', multiline: true },
      { key: 'webhook_secret', label: 'Webhook Secret', placeholder: '' },
    ],
    configFields: [
      { key: 'app_slug', label: 'App Slug', placeholder: 'your-taskapp' },
    ],
  },
  {
    key: 'slack',
    label: 'Slack',
    icon: ChatCircleDots,
    iconColor: 'text-[#4A154B]',
    credentialFields: [
      { key: 'client_id', label: 'Client ID', placeholder: '' },
      { key: 'client_secret', label: 'Client Secret', placeholder: '' },
      { key: 'signing_secret', label: 'Signing Secret', placeholder: '' },
      { key: 'state_secret', label: 'State Secret (HMAC)', placeholder: '' },
    ],
  },
  {
    key: 'google_calendar',
    label: 'Google Calendar',
    icon: CalendarCheck,
    iconColor: 'text-blue-600',
    credentialFields: [
      { key: 'client_id', label: 'Client ID', placeholder: 'xxxx.apps.googleusercontent.com' },
      { key: 'client_secret', label: 'Client Secret', placeholder: '' },
      { key: 'state_secret', label: 'State Secret (HMAC)', placeholder: '' },
    ],
  },
  {
    key: 'zoom',
    label: 'Zoom',
    icon: VideoCamera,
    iconColor: 'text-blue-500',
    credentialFields: [
      { key: 'client_id', label: 'Client ID', placeholder: '' },
      { key: 'client_secret', label: 'Client Secret', placeholder: '' },
      { key: 'account_id', label: 'Account ID (S2S)', placeholder: '' },
    ],
    configFields: [
      { key: 'redirect_uri', label: 'Redirect URI', placeholder: 'https://your-domain.com/api/integrations/callback/zoom' },
    ],
  },
  {
    key: 'teams',
    label: 'Microsoft Teams',
    icon: MicrosoftTeamsLogo,
    iconColor: 'text-purple-600',
    credentialFields: [
      { key: 'client_id', label: 'Client ID', placeholder: '' },
      { key: 'client_secret', label: 'Client Secret', placeholder: '' },
      { key: 'tenant_id', label: 'Tenant ID', placeholder: '' },
    ],
    configFields: [
      { key: 'redirect_uri', label: 'Redirect URI', placeholder: 'https://your-domain.com/api/integrations/callback/teams' },
    ],
  },
]

function ProviderCard({ def }: { def: ProviderDef }) {
  const { data: configs } = useSystemIntegrations()
  const saveMutation = useSaveSystemIntegration()
  const deleteMutation = useDeleteSystemIntegration()

  const existing = configs?.find((c) => c.provider === def.key)
  const [isEditing, setIsEditing] = useState(false)
  const [enabled, setEnabled] = useState(existing?.enabled ?? false)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [showSecrets, setShowSecrets] = useState(false)

  const Icon = def.icon

  const handleEdit = () => {
    setIsEditing(true)
    setEnabled(existing?.enabled ?? false)
    const existingConfig = (existing?.config ?? {}) as Record<string, string>
    const cfgInit: Record<string, string> = {}
    def.configFields?.forEach((f) => {
      cfgInit[f.key] = existingConfig[f.key] ?? ''
    })
    setConfigValues(cfgInit)
    setCredentials({})
  }

  const handleSave = async () => {
    const missingFields = def.credentialFields.filter(
      (f) => !credentials[f.key]?.trim(),
    )
    if (missingFields.length > 0 && !existing) {
      toast.error(`必須項目を入力してください: ${missingFields.map((f) => f.label).join(', ')}`)
      return
    }

    if (existing && missingFields.length > 0) {
      toast.error('更新時もすべてのクレデンシャルを再入力してください（セキュリティのため復号済み値は表示しません）')
      return
    }

    const configObj: Record<string, unknown> = {}
    def.configFields?.forEach((f) => {
      if (configValues[f.key]?.trim()) {
        configObj[f.key] = configValues[f.key].trim()
      }
    })

    try {
      await saveMutation.mutateAsync({
        provider: def.key,
        enabled,
        credentials,
        config: configObj,
      })
      toast.success(`${def.label} の設定を保存しました`)
      setIsEditing(false)
      setCredentials({})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存に失敗しました')
    }
  }

  const handleDelete = async () => {
    if (!confirm(`${def.label} の設定を削除しますか？`)) return
    try {
      await deleteMutation.mutateAsync(def.key)
      toast.success(`${def.label} の設定を削除しました`)
      setIsEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${def.iconColor}`} weight="bold" />
          <h3 className="font-medium text-gray-900">{def.label}</h3>
        </div>
        <div className="flex items-center gap-2">
          {existing ? (
            <span className="flex items-center gap-1.5 text-xs font-medium">
              {existing.enabled ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500" weight="fill" />
                  <span className="text-green-700">有効</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-gray-400" weight="fill" />
                  <span className="text-gray-500">無効</span>
                </>
              )}
            </span>
          ) : (
            <span className="text-xs text-gray-400">未設定</span>
          )}
        </div>
      </div>

      <div className="px-5 py-4">
        {!isEditing ? (
          <div className="space-y-3">
            {existing && (
              <div className="text-xs text-gray-500 space-y-1">
                {Object.entries(existing.maskedCredentials).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="font-mono text-gray-400 w-32 truncate">{k}:</span>
                    <span className="font-mono">{v}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleEdit}
                className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                {existing ? '編集' : '設定する'}
              </button>
              {existing && (
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  title="設定を削除"
                >
                  <Trash className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">有効にする</span>
            </label>

            <button
              onClick={() => setShowSecrets(!showSecrets)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
            >
              {showSecrets ? <EyeSlash className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showSecrets ? '値を隠す' : '値を表示'}
            </button>

            <div className="space-y-3">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">クレデンシャル</h4>
              {existing && (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  <Warning className="w-3.5 h-3.5 mt-0.5 shrink-0" weight="bold" />
                  <span>セキュリティ上、保存済みの値は表示しません。更新時はすべて再入力してください。</span>
                </div>
              )}
              {def.credentialFields.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {field.label}
                  </label>
                  {field.multiline ? (
                    <textarea
                      value={credentials[field.key] ?? ''}
                      onChange={(e) =>
                        setCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      rows={4}
                      className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                    />
                  ) : (
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      value={credentials[field.key] ?? ''}
                      onChange={(e) =>
                        setCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              ))}
            </div>

            {def.configFields && def.configFields.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">設定</h4>
                {def.configFields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {field.label}
                    </label>
                    <input
                      type="text"
                      value={configValues[field.key] ?? ''}
                      onChange={(e) =>
                        setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {saveMutation.isPending ? (
                  <CircleNotch className="w-4 h-4 animate-spin" />
                ) : (
                  <FloppyDisk className="w-4 h-4" />
                )}
                保存
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminIntegrationsPage() {
  const { isLoading, error } = useSystemIntegrations()

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">外部連携設定</h1>
        <p className="text-sm text-gray-500 mt-1">
          システム全体のOAuth設定を管理します。ここで設定した値は全組織に適用されます。
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <CircleNotch className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          設定の読み込みに失敗しました。SYSTEM_ENCRYPTION_KEY が設定されているか確認してください。
        </div>
      ) : (
        <div className="space-y-4">
          {PROVIDERS.map((def) => (
            <ProviderCard key={def.key} def={def} />
          ))}
        </div>
      )}

      <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="text-sm font-medium text-gray-700 mb-2">環境変数フォールバック</h3>
        <p className="text-xs text-gray-500">
          DB設定が見つからない場合、従来の環境変数（SLACK_CLIENT_ID等）が使用されます。
          DB設定が優先されるため、移行完了後は環境変数を削除できます。
        </p>
      </div>
    </div>
  )
}
