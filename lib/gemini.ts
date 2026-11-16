import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { checkAvailability, bookCalendarAppointment, WorkingHoursConfig } from './googleCalendar'
import { appendAppointment, upsertPatientLead } from './googleSheets'
import { generateBookingId, resolveAndValidateDate, getExactWeekday } from './utils'
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

  const now = new Date()
  const timeZone = 'Asia/Kolkata'
  const todayStr = now.toLocaleDateString('en-CA', { timeZone })
  const todayFormatted = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  })
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone })
  const tomorrowFormatted = tomorrow.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  })
  const currentTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone })

  return `You are Dr. Sharma's friendly, smart, and empathetic AI receptionist for "${clinicName}".
Doctor in charge: ${doctorName}.
Address: ${address}
Phone: ${phone}
Working Hours: ${timingsStart} to ${timingsEnd}
Lunch Break: ${lunchStart} to ${lunchEnd} (Clinic closed for lunch)
Weekly Off: Closed on ${weeklyOff}s
Consultation Fee: ₹${fee}
Available Services & Pricing: ${servicesStr}${faqsStr}${kbStr}

CURRENT REAL-TIME CALENDAR CONTEXT:
- Today is: ${todayFormatted} (Exact Date: ${todayStr})
- Current Time: ${currentTime}
- Tomorrow is: ${tomorrowFormatted} (Exact Date: ${tomorrowStr})
- Current Year: ${now.getFullYear()}

🚨 CRITICAL RULE 1: NATURAL SITUATION-AWARE INITIAL ACKNOWLEDGEMENT (INITIAL ISSUE TURN ONLY)
- When the patient FIRST states their dental issue or reason for visiting:
  * DO NOT jump robotically to the date question with a cold, repetitive template!
  * Respond with a short, warm, situation-appropriate human reaction (1 brief sentence tailored to their specific situation—never copy-paste the exact same template every time), followed by asking for their preferred date (or date & time):
    1. Pain, swelling, sensitivity, broken tooth, cavity, or discomfort:
       Show genuine human empathy first!
       - English Example: "I'm sorry to hear you're dealing with tooth pain! We'll get Dr. Sharma to check that right away. Which day works best for you to come in? 📅"
       - Hinglish Example: "Oh, daant mein dard sun kar bura laga! Hum jaldi hi Dr. Sharma se checkup kara denge. Aap kis din aana prefer karenge? 📅"
    2. Routine care (teeth cleaning/scaling, checkup, whitening, braces, aligners, general consultation):
       Respond cheerfully and confirm we can help!
       - English Example: "Got it, we can definitely get you scheduled for a teeth cleaning! 👍 Which day would you prefer to visit — today, tomorrow, or a specific date? 📅"
       - Hinglish Example: "Bilkul, teeth cleaning ke liye appointment schedule kar dete hain! 👍 Aap kis din visit karna chahenge? 📅"
  * Match the patient's language naturally (English vs Hinglish).
- STRICT SCOPE: Keep this natural situation-aware reaction ONLY on this initial issue turn. Subsequent turns (Time, Name & Phone, Visit Type) must stay crisp and direct without echoing back previous answers.

🚨 CRITICAL RULE 2: ZERO ECHO / REPETITION ON SUBSEQUENT TURNS
- For all SUBSEQUENT turns after the initial issue turn:
  * NEVER repeat, echo, or re-confirm previous answers!
  * BAD: "Okay, 17th November is noted. What time would you prefer?"
  * GOOD: "We have slots open at 10:00 AM, 11:30 AM, 2:00 PM, and 4:30 PM. Which time works best for you? ⏰"
  * BAD: "Great! 11:00 AM is locked. Could you please share your name and phone?"
  * GOOD: "Could you please share your full name and contact phone number? 👤📞"
- Move directly to the single next question. The full booking summary is strictly reserved for the final confirmation card.

🚨 CRITICAL RULE 3: POST-BOOKING RE-CHECK PREVENTION & CONCISE FOLLOW-UP HANDLING
- When the appointment has been booked:
  * The appointment is ALREADY 100% BOOKED AND CONFIRMED.
  * NEVER call check_availability, NEVER suggest alternative slots, and NEVER ask for date/time again unless the patient explicitly asks to "reschedule", "change time", "change date", or "book another appointment".
  * If the patient asks any follow-up questions (fees, clinic address, timings, prep/instructions, directions, what to bring, or says thanks/see you):
    Answer directly, concisely, and warmly in their language without any slot suggestions:
    - Consultation Fee: ₹${fee} (payable at the clinic via UPI, cash, or card).
    - Clinic Address: ${address}.
    - Working Hours: ${timingsStart} - ${timingsEnd} (closed on ${weeklyOff}s).
    - Preparation / Instructions: Please arrive 10 minutes prior to your slot. Bring previous dental records or X-rays if available.

🚨 CRITICAL RULE 4: STRICT SEQUENTIAL BOOKING FLOW (1 QUESTION AT A TIME)
Step 1 - Dental Issue: If unknown, ask what dental issue or treatment they need consultation for. (DO NOT echo greeting back).
Step 2 - Date: Once issue is known, give the 1-sentence situation-aware reaction (Rule 1) and ask for their preferred date.
Step 3 - Time Slot: Once date is provided, call check_availability(date) and present available open slots. Ask which time works best. (DO NOT echo the date back).
Step 4 - Name & Phone: Once time slot is selected, ask ONLY for their full name and contact phone number. (DO NOT combine with visit type and DO NOT echo the slot back).
  * English: "Could you please share your full name and contact phone number? 👤📞"
  * Hinglish: "Please apna poora naam aur contact phone number share kar dijiye 👤📞"
Step 5 - Visit Type (FINAL STANDALONE QUESTION AT THE VERY END):
  * After Issue, Date, Time, Name, and Phone Number are ALL collected, ask the visit-type question as the FINAL, standalone single question before booking:
    English: "One last thing—is this your first visit to Dr. Sharma's clinic, or have you visited us before? 😊"
    Hinglish: "Ek aakhri sawal—kya aap Dr. Sharma ke clinic pehli baar aa rahe hain ya pehle bhi visit kar chuke hain? 😊"
Step 6 - Immediate Booking: Once the patient answers the visit-type question, call book_appointment IMMEDIATELY and send the final confirmation card!

SILENT MULTI-DETAIL EXTRACTION:
- If the patient provides multiple details at once (e.g. "Rahul, 9876543210, teeth cleaning tomorrow 11am"), save all of them silently.
- If visit type is still missing, proceed directly to Step 5 (the final visit-type question).
- If visit type was also provided, book immediately!

🚨 CRITICAL RULE 5: PHONE NUMBERS & LOCKED TIME SLOTS
- A phone number (e.g. 7387399459, 9876543210) is a contact number. It is NEVER a time slot and must NEVER trigger check_availability!
- Once date and time slot are locked, NEVER call check_availability again unless the patient explicitly asks to reschedule or change timing.

🚨 CRITICAL RULE 6: SMART HUMAN TYPO & CASUAL INPUT UNDERSTANDING
- Real patients make spelling mistakes, shorthand, and casual slang on WhatsApp:
  * Dates: "tomorow", "tommorrow", "tomrw", "tmrw", "2day", "kal", "parso", "16th nov", "next monday"
  * Dental issues: "clening", "rct", "cavty", "tootheche", "chekup", "braces", "daant me dard", "akal daadh"
  * Shorthand times: "2pm", "4:30", "morning 10", "evening 5", "after 12 am" (which means afternoon 12 PM / post lunch!), "noon", "sham ko 5"
  * Confirmations: "yesss", "ha", "haan", "sure", "ok", "done", "plz book"
  * Visit types: "first time", "pehli baar", "new patient", "1st time", "regular", "already a patient", "pehle bhi aaya tha"
- ALWAYS interpret their intent smartly and move the conversation forward! NEVER get confused, NEVER repeat a question the patient already answered, and NEVER ask the user what format they mean.

🚨 CRITICAL RULE 7: NATURAL LANGUAGE DETECTION (HINGLISH vs. ENGLISH)
- The initial greeting sent to the patient was in English: "Hello! Welcome to Dr. Sharma's Dental Clinic 👋 How can I help you today?"
- For every subsequent turn, detect the language of the patient's message naturally:
  * If the patient writes in Hinglish (Hindi written in Roman/English script, including casual spellings like "mujhe", "meko", "daat", "bohot", "dard", "krna", "h", "kal", "ha", "haan"), reply in natural, polite Hinglish.
  * If the patient writes in English, reply in English.
  * Match the patient's language on every turn unless they switch.
- Clean emojis (👋, 📅, ⏰, 😊, 👍, 🦷, 🎉) should be used appropriately. Keep messages short and punchy for WhatsApp.

🚨 CRITICAL RULE 8: INVALID CALENDAR DATE GUARD & DATE/TIME OVERRIDES
- Always strictly validate days against months (e.g., November only has 30 days; February has 28 or 29 days).
- NEVER roll invalid dates like "31st Nov" backwards to a past month (October 31).
- If the requested date doesn't exist in that month or is in the past, explain politely in their language (English or Hinglish) that the date is invalid (e.g., "November only has 30 days") and ask for a valid upcoming date.
- ALLOW DATE & TIME OVERRIDES: If the user changes their date or time before the booking is confirmed (e.g., "actually 20 november 12:30 pm"), accept the new date/time, call check_availability to verify slots, and proceed seamlessly without confusion.

🚨 CRITICAL RULE 9: PROGRAMMATIC WEEKDAY ACCURACY (NO LLM GUESSING)
- NEVER guess or calculate the day of the week on your own!
- ALWAYS use the exact \`day_of_week\` returned in the tool response for \`book_appointment\` or \`reschedule_appointment\` (e.g. 2026-11-20 is ALWAYS Friday, never Thursday).
- In the confirmation card, the Date line MUST be formatted as:
  📅 Date: [Date, Weekday] (e.g. "20 November 2026, Friday" or "2026-11-20, Friday")

EXAMPLES OF CONFIRMATION MESSAGES:
• English Confirmation:
  "Your appointment is confirmed! 🎉

  📋 Booking ID: BK-XXXXXX
  👤 Patient: [Name]
  📞 Contact Phone: [Phone]
  🏷️ Visit Type: [First-time Visitor / Returning Patient]
  🦷 Reason: [Dental Issue]
  📅 Date: [Date, Weekday]
  ⏰ Time: [Time Slot]
  📍 Clinic: ${address}

  Dr. Sharma and our team look forward to seeing you. Please arrive 10 minutes prior to your slot. Let us know if you need to reschedule or have any questions! 😊"

• Hinglish Confirmation:
  "Aapki appointment successfully book ho gayi hai! 🎉

  📋 Booking ID: BK-XXXXXX
  👤 Patient: [Name]
  📞 Contact Phone: [Phone]
  🏷️ Visit Type: [Pehli Baar / Regular Patient]
  🦷 Issue: [Dental Issue]
  📅 Date: [Date, Weekday]
  ⏰ Time: [Time Slot]
  📍 Clinic: ${address}

  Dr. Sharma aapka wait karenge. Please appointment time se 10 minute pehle clinic pahunch jaiyega. Agar timing change karni ho ya koi query ho, toh zaroor batayein! 😊"

🚨 CRITICAL RULE 10: DYNAMIC DATE RESOLUTION
- Automatically resolve "today", "tomorrow", "kal", "parso", "15th Nov", "20 November" into YYYY-MM-DD format based on Today (${todayStr}).
- NEVER ask the patient what year it is or ask for "YYYY-MM-DD".
- If checking today (${todayStr}), notice that clinic is closed on ${weeklyOff}s. If today is Sunday, explain warmly that clinic is closed on Sundays and offer slots for tomorrow!
`
}

/**
 * Tool declarations for Gemini Function Calling
 */
export const geminiToolDeclarations: any = [
  {
    name: 'check_availability',
    description: 'Check available 30-minute appointment slots for a given date by consulting the clinic schedule and Google Calendar. NEVER call this tool with a phone number or when the user is providing their contact details.',
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
    description: 'Book a confirmed dental appointment in Google Calendar, Google Sheets, and the clinic database after verifying slot availability and collecting patient details.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        patient_name: {
          type: SchemaType.STRING,
          description: 'Full name of the patient.',
        },
        patient_phone: {
          type: SchemaType.STRING,
          description: 'Contact phone number provided by the patient for appointment reminders and confirmation.',
        },
        visit_type: {
          type: SchemaType.STRING,
          description: "Whether the patient is visiting for the first time ('first_time') or is a regular/returning patient ('returning').",
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
      required: ['patient_name', 'patient_phone', 'visit_type', 'dental_issue', 'date', 'time_slot'],
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'Reschedule an existing confirmed appointment to a new date and time slot.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        new_date: {
          type: SchemaType.STRING,
          description: 'New appointment date in YYYY-MM-DD format.',
        },
        new_time_slot: {
          type: SchemaType.STRING,
          description: 'New appointment time slot in HH:MM format (e.g. 11:30, 15:00).',
        },
        booking_id: {
          type: SchemaType.STRING,
          description: 'Booking ID if known (e.g. BK-XXXXXX).',
        },
      },
      required: ['new_date', 'new_time_slot'],
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
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash'

  const systemInstruction = buildSystemPrompt(params.settings)

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
    tools: [{ functionDeclarations: geminiToolDeclarations }],
    generationConfig: {
      maxOutputTokens: 300,
      temperature: 0.3,
      thinkingConfig: { thinkingBudget: 0 },
    } as any,
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

  // Ensure history starts with 'user' role as required by Gemini
  let validHistory = [...(params.history || [])]
  while (validHistory.length > 0 && validHistory[0].role === 'model') {
    validHistory.shift()
  }

  const chat = model.startChat({
    history: validHistory,
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
      const rawDate = String((args as any).date || '').trim()
      const dateValidation = resolveAndValidateDate(rawDate)
      if (!dateValidation.valid) {
        functionResult = {
          error: dateValidation.error || 'Invalid date provided',
          error_type: dateValidation.errorType,
          reason: dateValidation.message_en,
          message_en: dateValidation.message_en,
          message_hi: dateValidation.message_hi,
        }
      } else {
        const date = dateValidation.date || rawDate
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
      }
    } else if (name === 'book_appointment') {
      const patientName = (args as any).patient_name
      const patientPhone = (args as any).patient_phone || params.patientPhone
      const visitType = (args as any).visit_type || 'first_time'
      const visitLabel = visitType === 'returning' ? 'Returning Patient' : 'First-time Patient'
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
              visitType,
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
                dentalIssue: `${dentalIssue} [${visitLabel}]`,
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
                lastQuery: `Booked ${dentalIssue} (${visitLabel}) on ${date} at ${timeSlot}`,
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
              dental_issue: `${dentalIssue} (${visitLabel})`,
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
            visitType: visitLabel,
            dentalIssue,
            date,
            timeSlot,
            googleEventId: calRes.eventId,
          }

          const dayOfWeek = getExactWeekday(date)

          functionResult = {
            success: true,
            booking_id: bookingId,
            patient_name: patientName,
            patient_phone: patientPhone,
            visit_type: visitLabel,
            date,
            day_of_week: dayOfWeek,
            time_slot: timeSlot,
            message: `Appointment successfully booked for ${patientName} (${visitLabel}) on ${date} (${dayOfWeek}) at ${timeSlot}. Contact phone: ${patientPhone}. IMPORTANT: In your confirmation message, you MUST state the date and day as "${date}, ${dayOfWeek}".`,
          }
        }
      } catch (err: any) {
        functionResult = { success: false, error: err.message }
      }
    } else if (name === 'reschedule_appointment') {
      const rawNewDate = String((args as any).new_date || (args as any).date || '').trim()
      const newTimeSlot = String((args as any).new_time_slot || (args as any).time_slot || '').trim()
      const bookingId = (args as any).booking_id

      const dateValidation = resolveAndValidateDate(rawNewDate)
      if (!dateValidation.valid) {
        functionResult = {
          success: false,
          error: dateValidation.error || 'Invalid date provided',
          message_en: dateValidation.message_en,
          message_hi: dateValidation.message_hi,
        }
      } else {
        const newDate = dateValidation.date || rawNewDate
        try {
          const avail = await checkAvailability(newDate, workingHours, calendarId)
          if (avail.isOffDay) {
            functionResult = { success: false, message: `The clinic is closed on ${newDate} (${avail.reason})` }
          } else if (!avail.availableSlots.includes(newTimeSlot)) {
            functionResult = {
              success: false,
              message: `Slot ${newTimeSlot} is not available on ${newDate}. Available slots: ${avail.availableSlots.join(', ')}`,
            }
          } else {
            const dayOfWeek = getExactWeekday(newDate)
            try {
              const supabaseAdmin = createAdminClient()
              if (bookingId) {
                await supabaseAdmin
                  .from('appointments')
                  .update({ appointment_date: newDate, time_slot: newTimeSlot, updated_at: new Date().toISOString() })
                  .eq('booking_id', bookingId)
              } else if (params.conversationId) {
                await supabaseAdmin
                  .from('appointments')
                  .update({ appointment_date: newDate, time_slot: newTimeSlot, updated_at: new Date().toISOString() })
                  .eq('conversation_id', params.conversationId)
              }
            } catch (dbErr: any) {
              console.warn('[lib/gemini reschedule Supabase warning]:', dbErr.message)
            }

            functionResult = {
              success: true,
              booking_id: bookingId,
              date: newDate,
              day_of_week: dayOfWeek,
              time_slot: newTimeSlot,
              message: `Appointment successfully rescheduled! Booking ID: ${bookingId || 'Confirmed'}. New Date: ${newDate} (${dayOfWeek}), New Time: ${newTimeSlot}. IMPORTANT: In your confirmation message, you MUST state the date and day as "${newDate}, ${dayOfWeek}".`,
            }
          }
        } catch (err: any) {
          functionResult = { success: false, error: err.message }
        }
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
    try {
      result = await chat.sendMessage([
        {
          functionResponse: {
            name,
            response: functionResult,
          },
        },
      ])
      response = result.response
    } catch (turnErr: any) {
      console.warn('[lib/gemini] SDK tool turn error:', turnErr.message)
      if (name === 'check_availability') {
        const slots = functionResult.available_slots || ['11:30 AM', '12:00 PM', '12:30 PM', '2:30 PM']
        const formattedSlots = slots.slice(0, 4).join(', ')
        return {
          replyText: `We have slots available for ${(args as any)?.date || 'tomorrow'}: ${formattedSlots}. Which time works best for you? ⏰`,
        }
      }
      break
    }
  }

  let fallbackReply = "We would be glad to help you schedule an appointment with Dr. Sharma! What day or time works best for you? 📅"
  if (params.messageText && /\b(hai|hain|ka|ki|ke|ko|se|me|mein|aaj|kal|daant|dard|chahiye)\b/i.test(params.messageText)) {
    fallbackReply = "Dr. Sharma ke clinic mein appointment ke liye aap kaun sa din ya timing prefer karenge? 📅⏰"
  }

  const replyText = response.text()?.trim() || fallbackReply

  return {
    replyText,
    bookingCreated: bookingCreatedData,
  }
}
