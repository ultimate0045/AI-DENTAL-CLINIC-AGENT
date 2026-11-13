import axios from 'axios'

const META_GRAPH_VERSION = 'v19.0'
const META_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`

export interface MetaSendResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Send text message through Meta WhatsApp Cloud API
 */
export async function sendTextMessage(to: string, text: string): Promise<MetaSendResult> {
  const token = process.env.META_ACCESS_TOKEN
  const phoneId = process.env.META_PHONE_NUMBER_ID

  if (!token || !phoneId) {
    return {
      success: false,
      error: 'META_ACCESS_TOKEN or META_PHONE_NUMBER_ID is missing in environment variables',
    }
  }

  // Ensure phone has no '+' or spaces
  const cleanRecipient = to.replace(/\D/g, '')

  try {
    const url = `${META_BASE_URL}/${phoneId}/messages`
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanRecipient,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    }

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    })

    const messageId = res.data?.messages?.[0]?.id
    return {
      success: true,
      messageId,
    }
  } catch (err: any) {
    const errorDetails = err?.response?.data?.error?.message || err?.message || 'Failed to send WhatsApp message'
    console.error('[Meta WhatsApp API Error]:', errorDetails)
    return {
      success: false,
      error: errorDetails,
    }
  }
}

/**
 * Send image or media message via WhatsApp
 */
export async function sendMediaMessage(
  to: string,
  mediaType: 'image' | 'document' | 'audio',
  mediaUrl: string,
  caption?: string
): Promise<MetaSendResult> {
  const token = process.env.META_ACCESS_TOKEN
  const phoneId = process.env.META_PHONE_NUMBER_ID

  if (!token || !phoneId) {
    return { success: false, error: 'Meta WhatsApp credentials missing' }
  }

  const cleanRecipient = to.replace(/\D/g, '')

  try {
    const url = `${META_BASE_URL}/${phoneId}/messages`
    const mediaPayload: any = { link: mediaUrl }
    if (caption && mediaType === 'image') {
      mediaPayload.caption = caption
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanRecipient,
      type: mediaType,
      [mediaType]: mediaPayload,
    }

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    return {
      success: true,
      messageId: res.data?.messages?.[0]?.id,
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.response?.data?.error?.message || err?.message,
    }
  }
}

/**
 * Mark an incoming WhatsApp message as read
 */
export async function markMessageAsRead(messageId: string): Promise<boolean> {
  const token = process.env.META_ACCESS_TOKEN
  const phoneId = process.env.META_PHONE_NUMBER_ID
  if (!token || !phoneId || !messageId) return false

  try {
    const url = `${META_BASE_URL}/${phoneId}/messages`
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    )
    return true
  } catch (e) {
    return false
  }
}

/**
 * Check Meta WhatsApp connection
 */
export async function checkMetaConnection(): Promise<{ success: boolean; displayPhone?: string; verifiedName?: string; error?: string }> {
  const token = process.env.META_ACCESS_TOKEN
  const phoneId = process.env.META_PHONE_NUMBER_ID

  if (!token || !phoneId) {
    return {
      success: false,
      error: 'Meta credentials (META_ACCESS_TOKEN / META_PHONE_NUMBER_ID) not configured',
    }
  }

  try {
    const url = `${META_BASE_URL}/${phoneId}`
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 8000,
    })

    return {
      success: true,
      displayPhone: res.data?.display_phone_number || phoneId,
      verifiedName: res.data?.verified_name || 'WhatsApp Business Account',
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.response?.data?.error?.message || err?.message || 'Meta API connection failed',
    }
  }
}

/**
 * Retrieve binary or download URL for inbound WhatsApp media
 */
export async function getMediaUrl(mediaId: string): Promise<{ url?: string; mimeType?: string; error?: string }> {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) return { error: 'No META_ACCESS_TOKEN' }

  try {
    const res = await axios.get(`${META_BASE_URL}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    return {
      url: res.data.url,
      mimeType: res.data.mime_type,
    }
  } catch (err: any) {
    return { error: err?.message || 'Failed to fetch media metadata' }
  }
}
