"use client"

import { cn } from "@/lib/utils"

export interface ButtonProps {
  variant?: "default" | "primary" | "secondary" | "ghost" | "danger"
  size?: "xs" | "sm" | "md" | "lg"
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  className?: string
  children: React.ReactNode
  onClick?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  type?: "button" | "submit" | "reset"
  disabled?: boolean
  title?: string
  ariaLabel?: string
}

export function Button({
  variant = "default",
  size = "md",
  loading = false,
  leftIcon,
  rightIcon,
  className = "",
  children,
  onClick,
  onKeyDown,
  type = "button",
  disabled,
  title,
  ariaLabel,
}: ButtonProps) {
  const baseClasses = "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 cursor-pointer touch-manipulation select-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"

  const variantClasses = {
    default: "bg-surface2 border border-border text-zinc-200 hover:bg-zinc-700 hover:text-zinc-100",
    primary: "bg-accent-orange border border-accent-orange/50 text-white shadow-lg shadow-accent-orange/25 hover:bg-accent-orange/90",
    secondary: "bg-white/[0.06] border border-white/10 text-zinc-200 hover:bg-white/[0.10] hover:border-white/20",
    ghost: "bg-transparent border border-transparent text-zinc-300 hover:bg-white/[0.05] hover:text-zinc-100",
    danger: "bg-red-900/30 border border-red-900/50 text-danger hover:bg-red-900/50 hover:border-red-500",
  }

  const sizeClasses = {
    xs: "px-2.5 py-1 text-[11px] h-7 min-w-7",
    sm: "px-3 py-1.5 text-xs h-8 min-w-8",
    md: "px-3.5 py-2 text-xs sm:text-sm h-9 sm:h-10 min-h-[38px]",
    lg: "px-4.5 py-2.5 text-sm h-11 min-h-[44px] min-w-[88px]",
  }

  const isDisabled = disabled || loading

  return (
    <button
      type={type}
      onClick={onClick}
      onKeyDown={onKeyDown}
      title={title}
      aria-label={ariaLabel}
      disabled={isDisabled}
      className={cn(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        isDisabled && "opacity-40 cursor-not-allowed disabled:cursor-not-allowed active:scale-100",
        loading && "relative overflow-hidden",
        className
      )}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-xl">
          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </span>
      )}
      <span className={cn("flex items-center justify-center", loading && "invisible")}>
        {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
        {children}
        {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
      </span>
    </button>
  )
}