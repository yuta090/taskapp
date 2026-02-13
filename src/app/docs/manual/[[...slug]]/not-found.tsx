import Link from 'next/link'

export default function ManualNotFound() {
  return (
    <div className="max-w-3xl mx-auto px-8 py-12 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">
        ページが見つかりません
      </h1>
      <p className="text-gray-600 mb-8">
        お探しのマニュアルページは存在しないか、移動された可能性があります。
      </p>
      <Link
        href="/docs/manual"
        className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm"
      >
        マニュアルトップへ戻る
      </Link>
    </div>
  )
}
