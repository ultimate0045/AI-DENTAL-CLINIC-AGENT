import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { checkAvailability, bookCalendarAppointment, WorkingHoursConfig } from './googleCalendar'
import { appendAppointment, upsertPatientLead } from './googleSheets'
import { generateBookingId } from './utils'
import { ClinicSettings } from '@/types/index'
import { createAdminClient } from './supabase'

export interface GeminiProcessParams {
  conversationId: string
  patientPhone: string
  patientName?: string
  messageText: string
  imageUrl?: string
  imageBase64?: string
  imageMimeType?: string
  history?: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
  settings: Partial<ClinicSettings> & {
    services?: Array<{ name: string; price: number; duration_mins?: number; durationMinutes?: number }>
    faqs?: Array<{ question: string; answer: string }>
    knowledge_base_text?: string
  }
}

/**
 * Builds the dynamic system instruction prompt injecting all clinic parameters
 */
export function buildSystemPrompt(settings: any): string {
  const clinicName = settings.clinicName || settings.clinic_name || 'Dental Clinic'
  const doctorName = settings.doctorName || settings.doctor_name || 'Dr. Doctor'
  const address = settings.address || 'Clinic Address'
  const phone = settings.phone || 'Clinic Phone'
  const timingsStart = settings.timingsStart || settings.timings_start || '09:00'
  const timingsEnd = settings.timingsEnd || settings.timings_end || '18:00'
  const lunchStart = settings.lunchStart || settings.lunch_start || '13:00'
  const lunchEnd = settings.lunchEnd || settings.lunch_end || '14:00'
  const weeklyOff = settings.weeklyOff || settings.weekly_off || 'Sunday'
  const fee = settings.consultationFee ?? settings.consultation_fee ?? 500

  let servicesStr = 'General Consultation, Cleaning, Whitening, Root Canal Treatment, Braces, Tooth Extraction, Dental Implants'
  if (Array.isArray(settings.services) && settings.services.length > 0) {
    servicesStr = settings.services
      .map((s: any) => `${s.name}: ₹${s.price || 0}`)
      .join(', ')
  }

  let faqsStr = ''
  if (Array.isArray(settings.faqs) && settings.faqs.length > 0) {
    faqsStr = '\n\nFREQUENTLY ASKED QUESTIONS:\n' +
      settings.faqs.map((f: any) => `Q: ${f.question}\nA: ${f.answer}`).join('\n')
  }

  let kbStr = ''
  if (settings.knowledge_base_text || settings.knowledgeBaseText) {
    kbStr = `\n\nADDITIONAL CLINIC KNOWLEDGE BASE:\n${settings.knowledge_base_text || settings.knowledgeBaseText}`
  }

  return `You are the friendly, empathetic, and professional AI Receptionist for "${clinicName}".
Doctor in charge: ${doctorName}.
Address: ${address}
Phone: ${phone}
Working Hours: ${timingsStart} to ${timingsEnd}
Lunch Break: ${lunchStart} to ${lunchEnd}
Weekly Off: Closed on ${weeklyOff}s
Consultation Fee: ₹${fee}
Available Services & Pricing: ${servicesStr}${faqsStr}${kbStr}

RULES OF CONVERSATION:
1. Always be polite, warm, and professional. You represent a high-end dental clinic.
2. Reply in the exact same language or dialect as the patient (English, Hindi, Hinglish, etc.).
3. APPOINTMENT BOOKING PROCESS:
   - Before confirming any booking, you MUST use the tool \`check_availability(date)\` to get real-time open slots. Never guess or promise availability without checking.
   - You must collect 3 key pieces of information from the patient before booking:
     a) Patient's Full Name
     b) Specific Dental Issue or required treatment (e.g., toothache, cleaning, root canal)
     c) Preferred Date and Time slot
   - Once all details are gathered and slot is verified, call the tool \`book_appointment(patient_name, patient_phone, dental_issue, date, time_slot)\`.
   - After successful booking, provide the Booking ID, date, time, and clinic address clearly.
4. MEDICAL ADVICE DISCLAIMER:
   - You can explain basic dental symptoms and possible causes, but always advise that only ${doctorName} can provide an exact diagnosis after an in-clinic examination.
   - For emergencies (severe swelling, uncontrollable bleeding, severe trauma), instruct them to visit the clinic immediately or call emergency lines.
5. If the user shares an image of teeth/mouth, describe visible issues empathetically (e.g., "I notice some discoloration or minor chipping...") and gently encourage an in-person checkup.
`
}

/**
 * Tool declarations for Gemini Function Calling
 */
export const geminiToolDeclarations: any = [
  {
    name: 'check_availability',
    description: 'Check available 30-minute appointment slots for a given date by consulting the clinic schedule and Google Calendar.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: 'The appointment date in YYYY-MM-DD format.',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Book an appointment for a patient in Google Calendar and sync to the clinic Google Sheet.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        patient_name: {
          type: SchemaType.STRING,
          description: 'Full name of the patient.',
        },
        patient_phone: {
          type: SchemaType.STRING,
          description: 'Phone or WhatsApp number of the patient.',
        },
        dental_issue: {
          type: SchemaType.STRING,
          description: 'Brief description of the dental issue or treatment needed.',
        },
        date: {
          type: SchemaType.STRING,
          description: 'Appointment date in YYYY-MM-DD format.',
        },
        time_slot: {
          type: SchemaType.STRING,
          description: 'Appointment time slot in HH:MM format (e.g. 10:30, 15:00).',
        },
      },
      required: ['patient_name', 'patient_phone', 'dental_issue', 'date', 'time_slot'],
    },
  },
  {
    name: 'get_clinic_info',
    description: 'Retrieve specific clinic info such as full treatment menu, pricing, timings, or FAQs.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query_type: {
          type: SchemaType.STRING,
          description: 'Type of info needed: services, prices, timings, or faq.',
        },
      },
      required: ['query_type'],
    },
  },
]

/**
 * Process a message with Gemini including function calling loop
 */
export async function processWithGemini(params: GeminiProcessParams): Promise<{
  replyText: string
  bookingCreated?: any
}> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

  const systemInstruction = buildSystemPrompt(params.settings)

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
    tools: [{ functionDeclarations: geminiToolDeclarations }],
  })

  const workingHours: WorkingHoursConfig = {
    timingsStart: params.settings.timingsStart || (params.settings as any).timings_start || '09:00',
    timingsEnd: params.settings.timingsEnd || (params.settings as any).timings_end || '18:00',
    lunchStart: params.settings.lunchStart || (params.settings as any).lunch_start || '13:00',
    lunchEnd: params.settings.lunchEnd || (params.settings as any).lunch_end || '14:00',
    weeklyOff: params.settings.weeklyOff || (params.settings as any).weekly_off || 'Sunday',
  }

  const calendarId = params.settings.googleCalendarId || (params.settings as any).google_calendar_id || process.env.GOOGLE_CALENDAR_ID
  const sheetId = params.settings.googleSheetId || (params.settings as any).google_sheet_id || process.env.GOOGLE_SHEET_ID

  const chat = model.startChat({
    history: params.history || [],
  })

  // Prepare user message parts
  const userParts: any[] = []
  if (params.messageText) {
    userParts.push({ text: params.messageText })
  }

  if (params.imageBase64 && params.imageMimeType) {
    userParts.push({
      inlineData: {
        data: params.imageBase64,
        mimeType: params.imageMimeType,
      },
    })
  }

  if (userParts.length === 0) {
    userParts.push({ text: 'Hello' })
  }

  let result = await chat.sendMessage(userParts)
  let response = result.response
  let bookingCreatedData: any = null

  // Function calling loop (handle up to 5 consecutive tool calls)
  let loopCount = 0
  while (response.functionCalls() && response.functionCalls()!.length > 0 && loopCount < 5) {
    loopCount++
    const functionCalls = response.functionCalls()!
    const call = functionCalls[0] // take first call
    const { name, args } = call

    let functionResult: any = {}

    if (name === 'check_availability') {
      const date = (args as any).date
      try {
        const avail = await checkAvailability(date, workingHours, calendarId)
        functionResult = {
          date,
          is_off_day: avail.isOffDay,
          reason: avail.reason || null,
          available_slots: avail.availableSlots,
        }
      } catch (err: any) {
        functionResult = { error: `Could not check calendar: ${err.message}` }
      }
    } else if (name === 'book_appointment') {
      const patientName = (args as any).patient_name
      const patientPhone = (args as any).patient_phone || params.patientPhone
      const dentalIssue = (args as any).dental_issue
      const date = (args as any).date
      const timeSlot = (args as any).time_slot

      const bookingId = generateBookingId()

      try {
        // 1. Double check availability
        const avail = await checkAvailability(date, workingHours, calendarId)
        if (avail.isOffDay) {
          functionResult = { success: false, message: `The clinic is closed on ${date} (${avail.reason})` }
        } else if (!avail.availableSlots.includes(timeSlot)) {
          functionResult = {
            success: false,
            message: `Slot ${timeSlot} is no longer available on ${date}. Open slots: ${avail.availableSlots.join(', ')}`,
          }
        } else {
          // 2. Book in Google Calendar
          const calRes = await bookCalendarAppointment(
            {
              patientName,
              patientPhone,
              dentalIssue,
              date,
              timeSlot,
            },
            calendarId
          )

          // 3. Append to Google Sheets Appointments Tab
          if (sheetId) {
            await appendAppointment(
              {
                bookingId,
                date,
                timeSlot,
                patientName,
                phone: patientPhone,
                dentalIssue,
                status: 'Confirmed',
                timestamp: new Date().toISOString(),
              },
              sheetId
            ).catch((e) => console.warn('[Sheets Append Warning]:', e.message))

            // 4. Upsert into Patients_Leads tab
            await upsertPatientLead(
              {
                patientName,
                phone: patientPhone,
                lastQuery: `Booked ${dentalIssue} on ${date} at ${timeSlot}`,
              },
              sheetId
            ).catch((e) => console.warn('[Sheets Lead Warning]:', e.message))
          }

          // 5. Save to Supabase appointments table
          try {
            const supabaseAdmin = createAdminClient()
            await supabaseAdmin.from('appointments').insert({
              booking_id: bookingId,
              conversation_id: params.conversationId || null,
              patient_name: patientName,
              patient_phone: patientPhone,
              dental_issue: dentalIssue,
              appointment_date: date,
              time_slot: timeSlot,
              status: 'Confirmed',
              created_at: new Date().toISOString(),
            })
          } catch (dbErr: any) {
            console.warn('[Supabase Appointments Warning]:', dbErr.message)
          }

          bookingCreatedData = {
            bookingId,
            patientName,
            patientPhone,
            dentalIssue,
            date,
            timeSlot,
            googleEventId: calRes.eventId,
          }

          functionResult = {
            success: true,
            booking_id: bookingId,
            message: `Appointment successfully booked for ${patientName} on ${date} at ${timeSlot}.`,
          }
        }
      } catch (err: any) {
        functionResult = { success: false, error: err.message }
      }
    } else if (name === 'get_clinic_info') {
      const queryType = (args as any).query_type
      functionResult = {
        clinic_name: params.settings.clinicName || (params.settings as any).clinic_name,
        services: params.settings.services,
        timings: `${workingHours.timingsStart} - ${workingHours.timingsEnd}`,
        lunch: `${workingHours.lunchStart} - ${workingHours.lunchEnd}`,
        weekly_off: workingHours.weeklyOff,
        faqs: params.settings.faqs,
      }
    }

    // Send function execution response back to model
    result = await chat.sendMessage([
      {
        functionResponse: {
          name,
          response: functionResult,
        },
      },
    ])
    response = result.response
  }

  const replyText = response.text() || 'Thank you for reaching out to us. How can I assist you with your dental care today?'

  return {
    replyText,
    bookingCreated: bookingCreatedData,
  }
}
