import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status')
    const countOnly = searchParams.get('countOnly') === 'true'
    const conversationId = searchParams.get('conversationId') || searchParams.get('conversation_id')
    const phone = searchParams.get('phone')

    const supabase = createAdminClient()

    let query = supabase
      .from('appointments')
      .select('*', { count: countOnly ? 'exact' : undefined })

    if (statusFilter) {
      query = query.eq('status', statusFilter)
    }

    if (conversationId) {
      query = query.eq('conversation_id', conversationId)
    } else if (phone) {
      const cleanPhone = phone.replace(/\D/g, '').slice(-10)
      if (cleanPhone) {
        query = query.ilike('patient_phone', `%${cleanPhone}%`)
      }
    }

    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined
    if (limit && limit > 0) {
      query = query.limit(limit)
    }

    if (countOnly) {
      const { count, error } = await query
      if (error) throw error
      return NextResponse.json({ success: true, count: count || 0 })
    }

    const { data: appointments, error } = await query
      .order('appointment_date', { ascending: true })
      .order('time_slot', { ascending: true })

    if (error) {
      throw error
    }

    // Lookup conversations to fill in missing conversation_ids by patient_phone
    const phoneList = (appointments || [])
      .filter((a) => !a.conversation_id && a.patient_phone)
      .map((a) => a.patient_phone.replace(/\D/g, ''))
      .filter(Boolean)

    let convMap: Record<string, string> = {}
    if (phoneList.length > 0) {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, phone_number')
      
      if (convs) {
        for (const c of convs) {
          const clean = (c.phone_number || '').replace(/\D/g, '')
          if (clean) convMap[clean] = c.id
        }
      }
    }

    const enrichedAppointments = (appointments || []).map((appt) => {
      let conversationId = appt.conversation_id
      if (!conversationId && appt.patient_phone) {
        const clean = appt.patient_phone.replace(/\D/g, '')
        // Check exact match or last 10 digits
        if (convMap[clean]) {
          conversationId = convMap[clean]
        } else {
          const last10 = clean.slice(-10)
          for (const [phone, id] of Object.entries(convMap)) {
            if (phone.endsWith(last10)) {
              conversationId = id
              break
            }
          }
        }
      }
      return {
        ...appt,
        conversation_id: conversationId || null,
      }
    })

    return NextResponse.json({
      success: true,
      appointments: enrichedAppointments,
      count: enrichedAppointments.length,
    })
  } catch (err: any) {
    console.error('Error fetching appointments:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch appointments' },
      { status: 500 }
    )
  }
}
