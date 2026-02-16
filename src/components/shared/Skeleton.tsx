/** Lightweight skeleton primitives for loading states. Pure Tailwind, zero dependencies. */

export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-3 bg-gray-200 rounded animate-pulse ${className}`} />
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />
}

export function SkeletonCircle({ className = '' }: { className?: string }) {
  return <div className={`rounded-full bg-gray-200 animate-pulse ${className}`} />
}
