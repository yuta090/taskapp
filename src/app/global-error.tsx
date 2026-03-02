'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <html lang="ja">
      <body>
        <div
          role="alert"
          style={{
            display: 'flex',
            minHeight: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif',
            backgroundColor: '#FCFCFD',
            padding: '1rem',
          }}
        >
          <div
            style={{
              maxWidth: '28rem',
              width: '100%',
              borderRadius: '0.5rem',
              border: '1px solid #E5E7EB',
              backgroundColor: 'white',
              padding: '2rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠</div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#111827', marginBottom: '0.25rem' }}>
              予期しないエラーが発生しました
            </h2>
            <p style={{ fontSize: '0.8125rem', color: '#6B7280', marginBottom: '1.5rem' }}>
              アプリケーションの読み込みに失敗しました。再試行してください。
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                backgroundColor: '#4F46E5',
                color: 'white',
                border: 'none',
                borderRadius: '0.375rem',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              再試行
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
