'use client'

import { forwardRef } from 'react'

interface AuthInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
}

export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
        <input
          ref={ref}
          className={`
            w-full px-3 py-2 rounded-lg border text-sm
            focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent
            disabled:bg-gray-100 disabled:cursor-not-allowed
            ${error ? 'border-red-300 bg-red-50' : 'border-gray-300'}
            ${className}
          `}
          {...props}
        />
        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}
      </div>
    )
  }
)

AuthInput.displayName = 'AuthInput'
