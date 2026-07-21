import { SecretaryTabNav } from '@/components/secretary/SecretaryTabNav'

interface Props {
  children: React.ReactNode
  params: Promise<{ orgId: string }>
}

/**
 * 秘書コンソール共通シェル — /{orgId}/secretary/**
 *
 * 秘書4タブ(メッセージ/確認待ち/ツール連携/つなぐ)に共通の親レイアウトを持たせ、
 * タブバー(SecretaryTabNav)をここで一元描画する。以前は各page.tsx配下のclientが
 * それぞれ自前でSecretaryTabNavを描画していたため、タブ切替のたびにタブバーごと
 * remountされ、ちらつき・不要な再取得が起きていた。
 *
 * `await params` 以外のawait/fetchは持たない(静的シェル)。Suspense境界はここに置かず
 * 各page側のみに持たせる — タブ切替時のfallbackがタブバーの下だけに収まるようにするため。
 * 配下の各page/clientは自前でSecretaryTabNavを描画しない(二重nav禁止)。
 */
export default async function SecretaryLayout({ children, params }: Props) {
  const { orgId } = await params
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SecretaryTabNav orgId={orgId} />
      {children}
    </div>
  )
}
