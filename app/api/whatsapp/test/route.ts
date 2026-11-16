import { NextResponse } from 'next/server'
import axios from 'axios'
import { getDynamicCredentials } from '@/lib/credentials'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const queryPhoneId = searchParams.get('phoneId')

    const creds = await getDynamicCredentials()
    const phoneId = queryPhoneId || creds.metaPhoneNumberId || process.env.META_PHONE_NUMBER_ID
    const token = creds.metaAccessToken || process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN

    if (!phoneId || !token) {
      return NextResponse.json({
        success: false,
        error: 'Phone Number ID or Meta Access Token is missing',
      })
    }

    const url = `https://graph.facebook.com/v19.0/${phoneId}`
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 8000,
    })

    const data = res.data
    return NextResponse.json({
      success: true,
      phoneId: data.id,
      displayName: data.verified_name || data.display_phone_number || 'Verified',
      qualityRating: data.quality_rating,
    })
  } catch (err: any) {
    const errorDetails = err?.response?.data?.error?.message || err?.message || 'Failed to verify Meta WhatsApp token'
    return NextResponse.json({
      success: false,
      error: errorDetails,
    })
  }
}
