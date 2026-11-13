'use client'
import React from 'react'
import { Toaster, toast as hotToast } from 'react-hot-toast'
import { cn } from '@/lib/utils'

// Re-export toast from react-hot-toast for convenience
export const toast = hotToast

// ToastProvider wraps your app layout
export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          borderRadius: '10px',
          background: '#1F2C33',
          color: '#fff',
          border: '1px solid #2A3942',
        },
        success: {
          iconTheme: { primary: '#25D366', secondary: '#fff' },
        },
        error: {
          iconTheme: { primary: '#ef4444', secondary: '#fff' },
        },
      }}
    />
  )
}

// Optional inline Toast display component
interface ToastProps {
  variant?: 'default' | 'success' | 'error' | 'warning'
  title: string
  description?: string
  className?: string
}

export function Toast({ variant = 'default', title, description, className }: ToastProps) {
  const variantStyles = {
    default: 'border-gray-200 bg-white dark:border-[#2A3942] dark:bg-[#1F2C33]',
    success: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20',
    error: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20',
    warning: 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20',
  }

  const dotStyles = {
    default: 'bg-gray-400',
    success: 'bg-[#25D366]',
    error: 'bg-red-500',
    warning: 'bg-yellow-500',
  }

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 shadow-sm',
        variantStyles[variant],
        className
      )}
    >
      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', dotStyles[variant])} />
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        )}
      </div>
    </div>
  )
}
