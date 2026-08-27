import React from 'react'

export interface ButtonProps {
  variant: 'primary' | 'danger' | 'ghost' | 'momo'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
}

const variantStyles: Record<ButtonProps['variant'], string> = {
  primary: 'bg-[#B8122A] text-white hover:bg-[#9a0f22] active:bg-[#7e0c1c]',
  danger:  'bg-[#B8122A] text-white hover:bg-[#9a0f22]',
  ghost:   'border border-[#C8CCD4] text-[#C8CCD4] hover:bg-white/5',
  momo:    'bg-[#FFCB05] text-black hover:bg-[#f0bc00] font-semibold',
}

const sizeStyles: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-11 px-4 text-sm',
  md: 'h-12 px-5 text-base',
  lg: 'h-14 px-6 text-base min-h-[56px]',
}

export function Button({
  variant,
  size = 'md',
  loading,
  disabled,
  fullWidth,
  children,
  onClick,
  type = 'button',
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center rounded-lg font-semibold transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        variantStyles[variant],
        sizeStyles[size],
        fullWidth ? 'w-full' : '',
        loading ? 'cursor-wait' : '',
      ].filter(Boolean).join(' ')}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading…
        </span>
      ) : children}
    </button>
  )
}
