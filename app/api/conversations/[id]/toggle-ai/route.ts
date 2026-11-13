import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const conversationId = params.id
    const body = await request.json()
    const aiMode = Boolean(body.aiMode)

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('conversations')
      .update({ ai_mode: aiMode })
      .eq('id', conversationId)
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({
      success: true,
      conversation: data,
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to toggle AI mode' },
      { status: 500 }
    )
  }
}
