import { NextResponse } from 'next/server'
import { handleStatusUpdate } from '@/app/api/appointments/[id]/status/route'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const id = body?.id || body?.appointmentId || body?.bookingId
    const status = body?.status || 'Completed'
    const notifyPatient = Boolean(body?.notifyPatient)

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Appointment ID is required in request body' },
        { status: 400 }
      )
    }

    return await handleStatusUpdate(id, status, { notifyPatient })
  } catch (err: any) {
    console.error('Error in PATCH /api/appointments/status:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to update appointment status' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  return PATCH(request)
}
