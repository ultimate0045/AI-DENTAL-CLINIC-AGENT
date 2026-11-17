import { NextResponse } from 'next/server'
import { handleStatusUpdate } from '@/app/api/appointments/[id]/status/route'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    return await handleStatusUpdate(id, 'Completed')
  } catch (err: any) {
    console.error('Error completing appointment:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to complete appointment' },
      { status: 500 }
    )
  }
}
