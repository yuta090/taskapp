'use client'

import { ReactNode } from 'react'

interface BentoCardProps {
    children: ReactNode
    className?: string
    title?: ReactNode
    action?: ReactNode
}

export function BentoCard({ children, className = '', title, action }: BentoCardProps) {
    return (
        <div className={`bg-white/90 backdrop-blur-sm rounded-3xl border border-white/60 shadow-lg p-6 flex flex-col ${className}`}>
            {(title || action) && (
                <div className="flex items-center justify-between mb-4">
                    {title && (
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                            {title}
                        </h3>
                    )}
                    {action && <div>{action}</div>}
                </div>
            )}
            <div className="flex-1 relative">
                {children}
            </div>
        </div>
    )
}
