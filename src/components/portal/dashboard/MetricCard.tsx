'use client'

import { ReactNode } from 'react'
import { BentoCard } from './BentoCard'

interface MetricCardProps {
    label: string
    value: ReactNode
    trend?: {
        value?: string
        isPositive?: boolean
        text?: string
    }
    icon?: ReactNode
    status?: 'default' | 'on_track' | 'at_risk' | 'needs_attention'
    className?: string
}

export function MetricCard({ label, value, trend, icon, status = 'default', className = '' }: MetricCardProps) {
    // Status indicator ring color
    const statusColor = {
        default: 'bg-gray-100',
        on_track: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]',
        at_risk: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]',
        needs_attention: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]',
    }

    return (
        <BentoCard className={className}>
            <div className="flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                    <span className="text-sm font-bold text-gray-500">{label}</span>
                    {status !== 'default' && (
                        <div className={`w-2.5 h-2.5 rounded-full ${statusColor[status]} animate-pulse`} />
                    )}
                </div>

                <div className="mt-2">
                    <div className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                        {icon && <span className="text-gray-400">{icon}</span>}
                        {value}
                    </div>

                    {trend && (
                        <div className="flex items-center gap-2 mt-2 text-xs font-medium">
                            {trend.value && (
                                <span className={`px-1.5 py-0.5 rounded-md ${trend.isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                                    }`}>
                                    {trend.value}
                                </span>
                            )}
                            <span className="text-gray-400">{trend.text}</span>
                        </div>
                    )}
                </div>
            </div>
        </BentoCard>
    )
}
