'use client'

import type { SlotResponseType } from '@/types/database'

interface SlotResponseInputProps {
  value: SlotResponseType
  onChange: (value: SlotResponseType) => void
  variant?: 'internal' | 'client'
  disabled?: boolean
}

const RESPONSE_OPTIONS: Array<{
  value: SlotResponseType
  internalLabel: string
  clientLabel: string
  color: string
  icon: string
}> = [
  {
    value: 'available',
    internalLabel: '参加可能',
    clientLabel: '参加できます',
    color: 'text-green-600',
    icon: '●',
  },
  {
    value: 'unavailable_but_proceed',
    internalLabel: '欠席OK（進めてください）',
    clientLabel: '欠席しますが、進めてください',
    color: 'text-amber-500',
    icon: '▲',
  },
  {
    value: 'unavailable',
    internalLabel: '参加不可',
    clientLabel: '参加できません',
    color: 'text-red-400',
    icon: '✕',
  },
]

export function SlotResponseInput({
  value,
  onChange,
  variant = 'internal',
  disabled = false,
}: SlotResponseInputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {RESPONSE_OPTIONS.map((option) => {
        const label = variant === 'client' ? option.clientLabel : option.internalLabel
        const isSelected = value === option.value
        return (
          <label
            key={option.value}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer min-h-[2.75rem] transition-colors ${
              isSelected
                ? 'bg-gray-100 ring-1 ring-gray-300'
                : 'hover:bg-gray-50'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            data-testid={`slot-response-${option.value}`}
          >
            <input
              type="radio"
              name="slot-response"
              value={option.value}
              checked={isSelected}
              onChange={() => !disabled && onChange(option.value)}
              disabled={disabled}
              className="sr-only"
            />
            <span className={`text-sm ${option.color}`}>{option.icon}</span>
            <span className="text-sm text-gray-700">{label}</span>
          </label>
        )
      })}
    </div>
  )
}

// Icon-only display for grid cells
export function SlotResponseIcon({
  response,
  size = 'sm',
}: {
  response: SlotResponseType | null
  size?: 'sm' | 'md'
}) {
  if (!response) {
    return (
      <span className={`${size === 'md' ? 'text-base' : 'text-sm'} text-gray-300`}>
        ◌
      </span>
    )
  }

  const option = RESPONSE_OPTIONS.find((o) => o.value === response)
  if (!option) return null

  return (
    <span className={`${size === 'md' ? 'text-base' : 'text-sm'} ${option.color}`}>
      {option.icon}
    </span>
  )
}
