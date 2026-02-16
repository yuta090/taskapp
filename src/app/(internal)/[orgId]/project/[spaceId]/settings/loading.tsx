import { SkeletonLine, SkeletonBlock } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="w-5 h-5 rounded" />
          <SkeletonLine className="w-20" />
        </div>
      </header>
      {/* Body: sidebar + content */}
      <div className="flex-1 min-h-0 flex">
        {/* Sidebar nav */}
        <nav className="w-[200px] flex-shrink-0 border-r border-gray-100 py-4 px-2 space-y-4">
          {Array.from({ length: 3 }).map((_, gi) => (
            <div key={gi} className="space-y-1">
              <SkeletonLine className="w-16 h-2 mx-2 mb-2" />
              {Array.from({ length: gi === 0 ? 3 : 2 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
                  <SkeletonBlock className="w-4 h-4 rounded flex-shrink-0" />
                  <SkeletonLine className={`${i % 2 === 0 ? 'w-16' : 'w-20'}`} />
                </div>
              ))}
            </div>
          ))}
        </nav>
        {/* Content area */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[800px] mx-auto px-6 py-6 space-y-6">
            <SkeletonLine className="w-24 h-4" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <SkeletonLine className="w-20 h-2.5" />
                <SkeletonBlock className={`h-9 rounded-md ${i % 2 === 0 ? 'w-full' : 'w-3/4'}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
