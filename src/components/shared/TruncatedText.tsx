'use client'

import { useRef, useState, useCallback, type ElementType } from 'react'

interface TruncatedTextProps {
  children: string
  className?: string
  as?: ElementType
}

/**
 * Text component that shows a native tooltip only when content is truncated.
 * Checks overflow on mouseEnter (no ResizeObserver) for minimal overhead.
 * Replaces `<span className="truncate">` — the `truncate` class is applied automatically.
 */
export function TruncatedText({
  children,
  className = '',
  as: Tag = 'span',
}: TruncatedTextProps) {
  const ref = useRef<HTMLElement>(null)
  const [title, setTitle] = useState<string | undefined>()

  const handleMouseEnter = useCallback(() => {
    const el = ref.current
    if (el && el.scrollWidth > el.clientWidth) {
      setTitle(children)
    }
  }, [children])

  const handleMouseLeave = useCallback(() => {
    setTitle(undefined)
  }, [])

  return (
    <Tag
      ref={ref}
      className={`truncate ${className}`}
      title={title}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </Tag>
  )
}
