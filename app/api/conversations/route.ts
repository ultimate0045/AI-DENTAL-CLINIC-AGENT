import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data: conversations, error } = await supabase
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false })

    if (error) {
      throw error
    }

    return NextResponse.json({
      success: true,
      conversations: conversations || [],
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch conversations' },
      { status: 500 }
    )
  }
}
