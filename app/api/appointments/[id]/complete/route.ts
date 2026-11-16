import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Appointment ID is required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Match by UUID or booking_id
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    const filterCol = isUuid ? 'id' : 'booking_id'

    const { data, error } = await supabase
      .from('appointments')
      .update({
        status: 'Completed',
        updated_at: new Date().toISOString(),
      })
      .eq(filterCol, id)
      .select()
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      appointment: data,
      message: `Appointment ${data.booking_id} marked as Completed.`,
    })
  } catch (err: any) {
    console.error('Error completing appointment:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to complete appointment' },
      { status: 500 }
    )
  }
}
