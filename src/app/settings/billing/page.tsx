'use client'

import { useState } from 'react'
import { BillingUsageCard, InvoiceHistory } from '@/components/billing'
import { useStripeStatus } from '@/lib/hooks/useStripeStatus'
import { useCurrentOrg } from '@/lib/hooks/useCurrentOrg'
import { useBillingLimits } from '@/lib/hooks/useBillingLimits'
import { ArrowLeft, CreditCard, Sparkle, Warning, Wrench, ArrowSquareOut, CircleNotch, Gear } from '@phosphor-icons/react'
import Link from 'next/link'

export default function BillingSettingsPage() {
  const { serverConfigured, loading: stripeLoading } = useStripeStatus()
  const { orgId, orgName, role, loading: orgLoading, error: orgError } = useCurrentOrg()
  const { limits } = useBillingLimits(orgId ?? undefined)
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)

  // 有料プランかどうか判定
  const isPaidPlan = limits?.plan_name && limits.plan_name !== 'Free'
  const isOwner = role === 'owner'

  async function handleManageSubscription() {
    if (!serverConfigured || !orgId || !isOwner) return

    setPortalLoading(true)
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      })

      const data = await response.json()

      if (data.url) {
        window.location.href = data.url
      } else {
        console.error('Portal failed:', data.error)
        alert(data.error || 'サブスクリプション管理ページを開けませんでした')
      }
    } catch (error) {
      console.error('Portal error:', error)
    } finally {
      setPortalLoading(false)
    }
  }

  async function handleUpgrade(planId: 'pro' | 'enterprise') {
    if (!serverConfigured || !orgId) return

    setUpgradeLoading(true)
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: orgId,
          plan_id: planId,
        }),
      })

      const data = await response.json()

      if (data.url) {
        window.location.href = data.url
      } else {
        console.error('Checkout failed:', data.error)
      }
    } catch (error) {
      console.error('Checkout error:', error)
    } finally {
      setUpgradeLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/inbox"
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">プランと請求</h1>
              <p className="text-sm text-gray-500">使用状況とサブスクリプションの管理</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* ローディング状態 */}
        {orgLoading && (
          <div className="flex items-center justify-center py-12">
            <CircleNotch className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        )}

        {/* 組織取得エラー */}
        {!orgLoading && orgError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <p className="text-red-700">{orgError}</p>
          </div>
        )}

        {/* Stripe未設定警告 */}
        {!stripeLoading && !serverConfigured && (
          <StripeSetupGuide />
        )}

        {/* 組織名表示 */}
        {!orgLoading && orgId && orgName && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500">組織</p>
            <p className="text-lg font-semibold text-gray-900">{orgName}</p>
          </div>
        )}

        {/* Usage Card */}
        <BillingUsageCard orgId={orgId ?? undefined} showWarnings={true} />

        {/* Upgrade Card */}
        <div className={`rounded-lg p-6 text-white ${
          serverConfigured
            ? 'bg-gradient-to-r from-indigo-500 to-purple-600'
            : 'bg-gray-400'
        }`}>
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-lg ${serverConfigured ? 'bg-white/20' : 'bg-white/10'}`}>
              <Sparkle className="w-6 h-6" weight="fill" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">プランをアップグレード</h3>
              <p className="mt-1 text-white/80 text-sm">
                より多くのプロジェクト、メンバー、ストレージで
                チームの可能性を広げましょう
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => handleUpgrade('pro')}
                  disabled={!serverConfigured || !orgId || upgradeLoading}
                  className={`px-4 py-2 font-medium rounded-lg transition-colors ${
                    serverConfigured && orgId
                      ? 'bg-white text-indigo-600 hover:bg-white/90'
                      : 'bg-white/20 text-white/60 cursor-not-allowed'
                  }`}
                >
                  {upgradeLoading ? '処理中...' : 'Proにアップグレード'}
                </button>
                <button
                  onClick={() => handleUpgrade('enterprise')}
                  disabled={!serverConfigured || !orgId || upgradeLoading}
                  className={`px-4 py-2 font-medium rounded-lg transition-colors ${
                    serverConfigured && orgId
                      ? 'bg-white/20 text-white hover:bg-white/30'
                      : 'bg-white/10 text-white/40 cursor-not-allowed'
                  }`}
                >
                  Enterprise
                </button>
              </div>
              {!serverConfigured && (
                <p className="mt-3 text-white/60 text-xs flex items-center gap-1">
                  <Warning className="w-4 h-4" />
                  決済機能を利用するにはStripeの設定が必要です
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Payment Method / Subscription Management */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <CreditCard className="w-5 h-5 text-gray-400" />
              <h3 className="text-lg font-semibold text-gray-900">
                {isPaidPlan ? 'サブスクリプション管理' : 'お支払い方法'}
              </h3>
            </div>
            {isPaidPlan && isOwner && serverConfigured && (
              <button
                onClick={handleManageSubscription}
                disabled={portalLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
              >
                {portalLoading ? (
                  <CircleNotch className="w-4 h-4 animate-spin" />
                ) : (
                  <Gear className="w-4 h-4" />
                )}
                {portalLoading ? '読み込み中...' : 'Stripeで管理'}
              </button>
            )}
          </div>
          {isPaidPlan ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                現在のプラン: <span className="font-semibold">{limits?.plan_name}</span>
              </p>
              {isOwner ? (
                <p className="text-sm text-gray-500">
                  「Stripeで管理」ボタンからプラン変更、支払い方法の更新、請求書のダウンロードができます。
                </p>
              ) : (
                <p className="text-sm text-gray-500">
                  サブスクリプションの管理は組織オーナーのみ可能です。
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              現在、無料プランをご利用中です。有料プランにアップグレードすると、
              ここでサブスクリプションを管理できます。
            </p>
          )}
        </div>

        {/* Billing History */}
        <InvoiceHistory orgId={orgId ?? undefined} />
      </main>
    </div>
  )
}

// Stripe未設定時のガイド表示
function StripeSetupGuide() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
      <div className="flex items-start gap-4">
        <div className="p-2 bg-amber-100 rounded-lg">
          <Wrench className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-amber-900">
            Stripe決済の設定が必要です
          </h3>
          <p className="mt-1 text-sm text-amber-700">
            有料プランへのアップグレード機能を有効にするには、Stripeの設定を完了してください。
          </p>

          <div className="mt-4 space-y-3">
            <div className="bg-white rounded-lg p-4 border border-amber-200">
              <h4 className="font-medium text-gray-900 mb-2">設定手順</h4>
              <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                <li>
                  <a
                    href="https://dashboard.stripe.com/register"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                  >
                    Stripeアカウントを作成
                    <ArrowSquareOut className="w-3 h-3" />
                  </a>
                </li>
                <li>
                  <a
                    href="https://dashboard.stripe.com/apikeys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                  >
                    APIキーを取得
                    <ArrowSquareOut className="w-3 h-3" />
                  </a>
                </li>
                <li>
                  <a
                    href="https://dashboard.stripe.com/products"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                  >
                    Pro/Enterprise プランの商品を作成
                    <ArrowSquareOut className="w-3 h-3" />
                  </a>
                </li>
                <li>
                  <a
                    href="https://dashboard.stripe.com/webhooks"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                  >
                    Webhookエンドポイントを設定
                    <ArrowSquareOut className="w-3 h-3" />
                  </a>
                </li>
                <li>.env.local に環境変数を追加</li>
              </ol>
            </div>

            <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
              <p className="text-xs text-gray-400 mb-2">環境変数の例:</p>
              <pre className="text-xs text-green-400 font-mono whitespace-pre">
{`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
