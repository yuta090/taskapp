'use client'

import { useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'
import { Copy, Check } from '@phosphor-icons/react'
import { Hint } from '@/components/secretary/Hint'

interface LineFriendQrProps {
  orgId: string
  /**
   * 手順表示の文脈。
   * - 'self'(既定): 自分をLINE秘書につなぐ（1:1）。QRで友だち追加→1:1トークにコード送信で完了。
   * - 'group': グループ連携。QRは「秘書を友だち追加する」ためのもの。連携完了は
   *   「友だち追加→グループに招待→グループのトークにコード送信」の3手順（QR単体では完了しない）。
   */
  purpose?: 'self' | 'group'
}

type OwnerType = 'org' | 'platform' | null

/**
 * LINE友だち追加QR（Botを見つけて友だち追加する手間だけを消す純粋加算UX）。
 *
 * **identity(本人特定)は一切変えない** — 「友だち追加した瞬間に紐付く」わけではなく、
 * 本人特定は従来どおりコード返信方式のみが正。必ず「①QRで友だち追加 → ②表示された
 * コードをトークに送信で連携完了（追加だけでは連携されません）」の2段階を表示する。
 *
 * basic_id は公開情報のため、取得はサーバー(/api/channels/line/basic-id)、QR画像化は
 * クライアント側（qrcode）で行う。credentials/access_token はこのコンポーネントに一切渡らない。
 */
export function LineFriendQr({ orgId, purpose = 'self' }: LineFriendQrProps) {
  const [basicId, setBasicId] = useState<string | null>(null)
  const [ownerType, setOwnerType] = useState<OwnerType>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/channels/line/basic-id?orgId=${orgId}`)
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || typeof json.basicId !== 'string') {
          setBasicId(null)
          setOwnerType(null)
          return
        }
        setBasicId(json.basicId)
        setOwnerType(json.ownerType === 'platform' ? 'platform' : json.ownerType === 'org' ? 'org' : null)
      } catch {
        if (!cancelled) {
          setBasicId(null)
          setOwnerType(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const normalizedBasicId = basicId ? (basicId.startsWith('@') ? basicId : `@${basicId}`) : null
  const friendUrl = normalizedBasicId ? `https://line.me/R/ti/p/${normalizedBasicId}` : null

  useEffect(() => {
    if (!friendUrl) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    toDataURL(friendUrl)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [friendUrl])

  const copy = async () => {
    if (!friendUrl) return
    await navigator.clipboard.writeText(friendUrl)
    setCopied(true)
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-surface p-4">
        <div className="h-4 w-32 rounded bg-gray-100 animate-pulse" />
      </div>
    )
  }

  if (!friendUrl) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        {/* Bot未プロビジョニング時の正直な期待値設定: 自動で使えるようになるのではなく、
            当社が開通しメールでご案内する申込制であることを明示する。 */}
        <p className="text-xs text-gray-500">
          LINE秘書は順番に開通しています。開通しましたら、ご登録のメールでご案内します（お急ぎの場合はサポートへご連絡ください）。
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-4">
      {ownerType === 'platform' && (
        <p className="text-xs font-semibold text-gray-900">
          この秘書は、ほかの事務所とも共通のアカウントです。友だち追加だけではどの事務所か分からないため、コードの送信が必ず必要です。
        </p>
      )}

      <div className="flex items-start gap-3">
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- data URLはnext/imageの対象外
          <img
            src={qrDataUrl}
            alt="LINE友だち追加QRコード"
            className="h-28 w-28 rounded border border-gray-200"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="break-all text-[11px] text-gray-500">{friendUrl}</p>
          <button
            type="button"
            onClick={() => void copy()}
            className="mt-2 flex items-center gap-1 rounded border border-gray-300 bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'コピー済み' : 'URLをコピー'}
          </button>
        </div>
      </div>

      <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
        {purpose === 'group' ? (
          <>
            <ol className="list-inside list-decimal space-y-0.5 text-xs text-amber-900">
              <li>QRでLINE秘書を友だち追加する</li>
              <li>秘書を相手先とのLINEグループに招待する</li>
              <li>コードを発行し、グループのトークに送る（発行はこの下のリンクから）</li>
            </ol>
            <p className="mt-1.5 text-[11px] font-medium text-amber-900">
              友だち追加・招待だけではつながりません。
              <Hint label="つながるタイミング">
                QRは秘書を友だち追加するためのものです。発行したコードをグループのトークに送った時点で、はじめてつながります。
              </Hint>
            </p>
          </>
        ) : (
          <>
            <ol className="list-inside list-decimal space-y-0.5 text-xs text-amber-900">
              <li>QRでLINE秘書を友だち追加する</li>
              <li>表示されたコードを秘書との1:1トークに送る</li>
            </ol>
            <p className="mt-1.5 text-[11px] font-medium text-amber-900">
              これでつながります。友だち追加だけではつながりません。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
