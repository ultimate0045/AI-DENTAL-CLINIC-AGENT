'use client'
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm',
          'placeholder:text-gray-400 text-gray-900',
          'focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'dark:border-[#3B4A54] dark:bg-[#2A3942] dark:text-gray-100 dark:placeholder:text-gray-500',
          'dark:focus:ring-[#25D366]',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
