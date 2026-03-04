'use client'

import { useState } from 'react'

interface AdminJsonViewerProps {
  data: unknown
  maxHeight?: number
}

export function AdminJsonViewer({ data, maxHeight = 200 }: AdminJsonViewerProps) {
  const [expanded, setExpanded] = useState(false)

  if (data == null) {
    return <span className="text-gray-400 text-xs">null</span>
  }

  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  const isLong = json.length > 200

  return (
    <div className="relative">
      <pre
        className={`text-xs bg-gray-50 rounded p-2 overflow-auto font-mono text-gray-700 ${
          !expanded && isLong ? 'line-clamp-3' : ''
        }`}
        style={expanded ? { maxHeight } : undefined}
      >
        {json}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-indigo-600 hover:text-indigo-700 mt-1"
        >
          {expanded ? '折りたたむ' : '展開する'}
        </button>
      )}
    </div>
  )
}
