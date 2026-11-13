'use client'
import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-gray-200 dark:bg-[#2A3942]',
        className
      )}
    />
  )
}

// Pre-built skeleton for chat list items
export function ConversationSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="h-12 w-12 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="h-3 w-48" />
      </div>
    </div>
  )
}

// Pre-built skeleton for message bubbles
export function MessageSkeleton({ direction = 'left' }: { direction?: 'left' | 'right' }) {
  return (
    <div className={cn('flex', direction === 'right' ? 'justify-end' : 'justify-start')}>
      <div className="space-y-1 max-w-xs">
        <Skeleton className={cn('h-10 rounded-xl', direction === 'right' ? 'w-48' : 'w-56')} />
        <Skeleton className="h-3 w-16 ml-auto" />
      </div>
    </div>
  )
}

export { Skeleton }
