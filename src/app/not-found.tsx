import Link from 'next/link'
import { Compass } from '@phosphor-icons/react/dist/ssr'

/**
 * アプリ共通の404。古い共有リンクや打ち間違いの受け皿。
 * 従来は docs/manual 配下にしか not-found が無く、素の404が出ていた。
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-amber-50 flex items-center justify-center">
          <Compass className="w-8 h-8 text-amber-500" />
        </div>
        <p className="text-5xl font-bold text-gray-900 tracking-tight">404</p>
        <h1 className="mt-3 text-lg font-semibold text-gray-900">
          ページが見つかりませんでした
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          リンクが古いか、URLが間違っている可能性があります。
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors"
          >
            トップページへ戻る
          </Link>
        </div>
      </div>
    </div>
  )
}
