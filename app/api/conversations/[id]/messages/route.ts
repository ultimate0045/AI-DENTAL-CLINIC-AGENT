import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const conversationId = params.id
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50', 10)

    const supabase = createAdminClient()

    // 1. Fetch conversation details
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single()

    // 2. Fetch messages ordered by creation time
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) {
      throw error
    }

    // 3. Mark unread as 0
    await supabase
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', conversationId)

    return NextResponse.json({
      success: true,
      conversation,
      messages: messages || [],
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch messages' },
      { status: 500 }
    )
  }
}
