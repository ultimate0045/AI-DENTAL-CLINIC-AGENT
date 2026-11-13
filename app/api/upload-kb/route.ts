import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file uploaded' },
        { status: 400 }
      )
    }

    const filename = file.name
    const mimetype = file.type
    const size = file.size

    // Read content
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    let textContent = ''

    if (mimetype.includes('text') || filename.endsWith('.txt') || filename.endsWith('.md')) {
      textContent = buffer.toString('utf-8')
    } else {
      // Basic text extraction or placeholder for binary docs
      textContent = `[Uploaded document: ${filename} (${size} bytes)]\n` + buffer.toString('utf-8', 0, Math.min(buffer.length, 10000)).replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, ' ')
    }

    const supabase = createAdminClient()

    // 1. Insert into knowledge_base table
    const { data: kbRecord, error: kbErr } = await supabase
      .from('knowledge_base')
      .insert({
        source_name: filename,
        content: textContent,
        metadata: {
          filename,
          size,
          mimetype,
          uploadedAt: new Date().toISOString(),
        },
      })
      .select()
      .single()

    // 2. Append/update in clinic_settings.knowledge_base_text
    const { data: settings } = await supabase
      .from('clinic_settings')
      .select('id, knowledge_base_text')
      .limit(1)
      .maybeSingle()

    if (settings?.id) {
      const existingText = settings.knowledge_base_text || ''
      const updatedText = existingText
        ? `${existingText}\n\n--- Document: ${filename} ---\n${textContent.slice(0, 5000)}`
        : `--- Document: ${filename} ---\n${textContent.slice(0, 5000)}`

      await supabase
        .from('clinic_settings')
        .update({ knowledge_base_text: updatedText })
        .eq('id', settings.id)
    }

    return NextResponse.json({
      success: true,
      filename,
      charCount: textContent.length,
      id: kbRecord?.id,
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to upload document' },
      { status: 500 }
    )
  }
}
