// server/server.js — WhatsApp AI Dental Receptionist Backend
// ES Module syntax (type: "module" in server/package.json)

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

// ─── Load .env.local from parent directory ───────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env.local') });

// ─── Constants ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.NEXT_PUBLIC_CLIENT_URL || 'http://localhost:3000';
const META_GRAPH_URL = 'https://graph.facebook.com/v19.0';

// ─── Supabase Client (service role) ──────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ─── Express + HTTP + Socket.io Setup ────────────────────────────────────────
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CLIENT_URL);
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Multer for file uploads (knowledge base)
const upload = multer({
  dest: join(__dirname, 'uploads/'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ─── Helper: Google Auth Client ───────────────────────────────────────────────
function getGoogleAuthClient() {
  const jsonPathParent = join(__dirname, '../service-account.json');
  const jsonPathLocal = join(__dirname, 'service-account.json');
  const jsonFile = fs.existsSync(jsonPathParent) ? jsonPathParent : (fs.existsSync(jsonPathLocal) ? jsonPathLocal : null);

  if (jsonFile) {
    return new google.auth.GoogleAuth({
      keyFile: jsonFile,
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    });
  }

  const email = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
    rawKey = rawKey.slice(1, -1);
  }
  const privateKey = rawKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: privateKey,
    },
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
}

function getCalendarClient() {
  const auth = getGoogleAuthClient();
  return google.calendar({ version: 'v3', auth });
}

function getSheetsClient() {
  const auth = getGoogleAuthClient();
  return google.sheets({ version: 'v4', auth });
}

// ─── Helper: Get Clinic Settings ─────────────────────────────────────────────
async function getClinicSettings() {
  try {
    const { data, error } = await supabase
      .from('clinic_settings')
      .select('*')
      .limit(1)
      .single();

    if (error || !data) throw new Error('No clinic settings in DB');
    return data;
  } catch {
    // Fallback to environment variables
    return {
      clinic_name: process.env.CLINIC_NAME || 'Dental Clinic',
      doctor_name: process.env.DOCTOR_NAME || 'Doctor',
      address: process.env.CLINIC_ADDRESS || '',
      timings_start: process.env.TIMINGS_START || '09:00',
      timings_end: process.env.TIMINGS_END || '18:00',
      lunch_start: process.env.LUNCH_START || '13:00',
      lunch_end: process.env.LUNCH_END || '14:00',
      weekly_off: process.env.WEEKLY_OFF || 'Sunday',
      consultation_fee: process.env.CONSULTATION_FEE || '',
      services: process.env.CLINIC_SERVICES || '',
      google_calendar_id: process.env.GOOGLE_CALENDAR_ID || '',
      google_sheet_id: process.env.GOOGLE_SHEET_ID || '',
      faq: process.env.CLINIC_FAQ || '',
    };
  }
}

// ─── Helper: Send WhatsApp Message ───────────────────────────────────────────
async function sendWhatsAppMessage(phone, text) {
  try {
    const url = `${META_GRAPH_URL}/${process.env.META_PHONE_NUMBER_ID}/messages`;
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'text',
        text: { preview_url: false, body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (err) {
    console.error('[sendWhatsAppMessage] Error:', err?.response?.data || err.message);
    throw err;
  }
}

// ─── Helper: Check Availability ──────────────────────────────────────────────
async function checkAvailability(date, settings) {
  try {
    const calendar = getCalendarClient();
    const calendarId = settings.google_calendar_id || process.env.GOOGLE_CALENDAR_ID;

    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59`);

    const eventsRes = await calendar.events.list({
      calendarId,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = eventsRes.data.items || [];

    // Build busy intervals from existing events
    const busyIntervals = events.map((e) => ({
      start: e.start.dateTime ? new Date(e.start.dateTime) : new Date(`${date}T${settings.timings_start}`),
      end: e.end.dateTime ? new Date(e.end.dateTime) : new Date(`${date}T${settings.timings_end}`),
    }));

    // Add lunch break as busy
    busyIntervals.push({
      start: new Date(`${date}T${settings.lunch_start || '13:00'}:00`),
      end: new Date(`${date}T${settings.lunch_end || '14:00'}:00`),
    });

    // Generate 30-min slots between timings_start and timings_end
    const freeSlots = [];
    const workStart = new Date(`${date}T${settings.timings_start || '09:00'}:00`);
    const workEnd = new Date(`${date}T${settings.timings_end || '18:00'}:00`);

    let slotStart = new Date(workStart);
    while (slotStart < workEnd) {
      const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
      if (slotEnd > workEnd) break;

      const isBusy = busyIntervals.some(
        (b) => slotStart < b.end && slotEnd > b.start
      );

      if (!isBusy) {
        const hh = String(slotStart.getHours()).padStart(2, '0');
        const mm = String(slotStart.getMinutes()).padStart(2, '0');
        freeSlots.push(`${hh}:${mm}`);
      }

      slotStart = slotEnd;
    }

    return freeSlots;
  } catch (err) {
    console.error('[checkAvailability] Error:', err.message);
    return [];
  }
}

// ─── Helper: Book Appointment ─────────────────────────────────────────────────
async function bookAppointmentAction(params, settings) {
  const { patient_name, patient_phone, dental_issue, date, time_slot } = params;

  // Re-verify slot is still free
  const freeSlots = await checkAvailability(date, settings);
  if (!freeSlots.includes(time_slot)) {
    return {
      success: false,
      message: `Sorry, the slot ${time_slot} on ${date} is no longer available. Available slots: ${freeSlots.join(', ')}`,
    };
  }

  const bookingId = `BK-${uuidv4().slice(0, 8).toUpperCase()}`;
  const startDateTime = new Date(`${date}T${time_slot}:00`);
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  // Create Google Calendar event
  try {
    const calendar = getCalendarClient();
    const calendarId = settings.google_calendar_id || process.env.GOOGLE_CALENDAR_ID;

    await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `${patient_name} - ${dental_issue}`,
        description: `Patient: ${patient_name}\nPhone: ${patient_phone}\nIssue: ${dental_issue}\nBooking ID: ${bookingId}`,
        start: { dateTime: startDateTime.toISOString() },
        end: { dateTime: endDateTime.toISOString() },
      },
    });
  } catch (err) {
    console.error('[bookAppointment] Calendar error:', err.message);
    // Continue — don't block booking if calendar fails
  }

  const timestamp = new Date().toISOString();
  const sheetId = settings.google_sheet_id || process.env.GOOGLE_SHEET_ID;

  // Append to Google Sheets — Appointments tab
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Appointments!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[bookingId, date, time_slot, patient_name, patient_phone, dental_issue, 'Confirmed', timestamp]],
      },
    });
  } catch (err) {
    console.error('[bookAppointment] Sheets Appointments error:', err.message);
  }

  // Upsert to Google Sheets — Patients_Leads tab
  try {
    const sheets = getSheetsClient();
    // Check if phone already exists in Patients_Leads
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Patients_Leads!B:B',
    });
    const phones = (existing.data.values || []).flat();
    const rowIndex = phones.indexOf(patient_phone);

    if (rowIndex > 0) {
      // Update last query summary (column D)
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Patients_Leads!D${rowIndex + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[dental_issue]] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Patients_Leads!A:D',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[patient_name, patient_phone, date, dental_issue]],
        },
      });
    }
  } catch (err) {
    console.error('[bookAppointment] Sheets Patients_Leads error:', err.message);
  }

  // Save appointment to Supabase
  try {
    await supabase.from('appointments').insert({
      booking_id: bookingId,
      patient_name,
      patient_phone,
      dental_issue,
      appointment_date: date,
      time_slot,
      status: 'Confirmed',
      created_at: timestamp,
    });
  } catch (err) {
    console.error('[bookAppointment] Supabase error:', err.message);
  }

  return {
    success: true,
    booking_id: bookingId,
    message: `Appointment confirmed! Booking ID: ${bookingId}. ${patient_name}'s appointment for ${dental_issue} is booked on ${date} at ${time_slot}.`,
  };
}

// ─── Gemini AI Processing ─────────────────────────────────────────────────────
async function processWithGemini(conversationId, phone, messageText, messageType, imageUrl) {
  try {
    const settings = await getClinicSettings();

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    // Build system prompt
    const systemPrompt = `You are ${settings.clinic_name}'s AI receptionist. The doctor is ${settings.doctor_name}.
Clinic address: ${settings.address}. Working hours: ${settings.timings_start}-${settings.timings_end}, Lunch: ${settings.lunch_start}-${settings.lunch_end}. Weekly off: ${settings.weekly_off}.
Consultation fee: ${settings.consultation_fee}. Services: ${settings.services}.

Your job: Answer queries politely, check availability before booking, collect patient Name + Dental Issue + Preferred Date/Time before confirming an appointment.
Always respond in the same language as the patient.
For appointment booking, always use the available tools.
Do NOT invent slot availability — always call check_availability first.
Be concise and friendly. Use simple formatting suitable for WhatsApp.`;

    // Fetch last 10 messages for conversation history
    const { data: historyRows } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);

    const history = (historyRows || [])
      .reverse()
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    // Define Gemini tools (function declarations)
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'check_availability',
            description: 'Check available appointment slots for a given date at the clinic.',
            parameters: {
              type: 'OBJECT',
              properties: {
                date: {
                  type: 'STRING',
                  description: 'Date to check in YYYY-MM-DD format',
                },
              },
              required: ['date'],
            },
          },
          {
            name: 'book_appointment',
            description: 'Book a confirmed appointment for a patient after collecting all required information.',
            parameters: {
              type: 'OBJECT',
              properties: {
                patient_name: { type: 'STRING', description: 'Full name of the patient' },
                patient_phone: { type: 'STRING', description: 'WhatsApp phone number of the patient' },
                dental_issue: { type: 'STRING', description: 'Dental issue or reason for visit' },
                date: { type: 'STRING', description: 'Appointment date in YYYY-MM-DD format' },
                time_slot: { type: 'STRING', description: 'Appointment time slot in HH:MM format (24h)' },
              },
              required: ['patient_name', 'patient_phone', 'dental_issue', 'date', 'time_slot'],
            },
          },
          {
            name: 'get_clinic_info',
            description: 'Get specific information about the clinic such as services, prices, timings, or FAQs.',
            parameters: {
              type: 'OBJECT',
              properties: {
                query_type: {
                  type: 'STRING',
                  enum: ['services', 'prices', 'timings', 'faq'],
                  description: 'Type of information requested',
                },
              },
              required: ['query_type'],
            },
          },
        ],
      },
    ];

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      tools,
    });

    const chat = model.startChat({ history });

    // Build user message parts
    const userParts = [];
    if (messageType === 'image' && imageUrl) {
      // Fetch image as base64 for Gemini
      try {
        const imgResponse = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
        });
        const base64 = Buffer.from(imgResponse.data).toString('base64');
        const mimeType = imgResponse.headers['content-type'] || 'image/jpeg';
        userParts.push({ inlineData: { data: base64, mimeType } });
      } catch (imgErr) {
        console.error('[processWithGemini] Image fetch error:', imgErr.message);
      }
    }
    userParts.push({ text: messageText || '[Patient sent an image]' });

    // Multi-turn function calling loop
    let result = await chat.sendMessage(userParts);
    let response = result.response;
    let finalText = '';

    for (let iterations = 0; iterations < 5; iterations++) {
      const candidate = response.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts || [];
      const functionCallPart = parts.find((p) => p.functionCall);

      if (!functionCallPart) {
        // Model returned text — we're done
        finalText = response.text();
        break;
      }

      const { name: fnName, args: fnArgs } = functionCallPart.functionCall;
      console.log(`[Gemini] Function call: ${fnName}`, fnArgs);

      // Execute the tool
      let fnResult;
      try {
        if (fnName === 'check_availability') {
          const slots = await checkAvailability(fnArgs.date, settings);
          fnResult = { available_slots: slots, date: fnArgs.date };
        } else if (fnName === 'book_appointment') {
          fnResult = await bookAppointmentAction(fnArgs, settings);
        } else if (fnName === 'get_clinic_info') {
          switch (fnArgs.query_type) {
            case 'services':
              fnResult = { info: settings.services || 'Information not available.' };
              break;
            case 'prices':
              fnResult = { info: `Consultation fee: ${settings.consultation_fee || 'Please contact the clinic.'}` };
              break;
            case 'timings':
              fnResult = {
                info: `Working hours: ${settings.timings_start} - ${settings.timings_end}. Lunch: ${settings.lunch_start} - ${settings.lunch_end}. Weekly off: ${settings.weekly_off}.`,
              };
              break;
            case 'faq':
              fnResult = { info: settings.faq || 'Please contact the clinic for more information.' };
              break;
            default:
              fnResult = { info: 'Unknown query type.' };
          }
        } else {
          fnResult = { error: `Unknown function: ${fnName}` };
        }
      } catch (toolErr) {
        console.error(`[Gemini] Tool error (${fnName}):`, toolErr.message);
        fnResult = { error: toolErr.message };
      }

      // Send function result back to Gemini
      result = await chat.sendMessage([
        {
          functionResponse: {
            name: fnName,
            response: fnResult,
          },
        },
      ]);
      response = result.response;
    }

    if (!finalText) {
      finalText = response.text?.() || 'I apologize, I am unable to process your request at the moment.';
    }

    // Save AI response to Supabase
    await supabase.from('chat_messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: finalText,
      message_type: 'text',
      created_at: new Date().toISOString(),
    });

    // Send WhatsApp reply
    await sendWhatsAppMessage(phone, finalText);

    // Emit socket event
    io.to(conversationId).emit('new_message', {
      conversation_id: conversationId,
      role: 'assistant',
      content: finalText,
      message_type: 'text',
      created_at: new Date().toISOString(),
    });

    return finalText;
  } catch (err) {
    console.error('[processWithGemini] Fatal error:', err.message);
    // Try to send a fallback message
    try {
      await sendWhatsAppMessage(phone, 'Sorry, I am experiencing technical difficulties. Please try again shortly.');
    } catch {}
  }
}

// ─── Socket.io Events ─────────────────────────────────────────────────────────
io.on('connection', async (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // Emit connection status
  try {
    const status = await getConnectionStatus();
    socket.emit('connection_status', status);
  } catch (err) {
    console.error('[Socket.io] Status emit error:', err.message);
  }

  socket.on('join_conversation', (conversationId) => {
    socket.join(conversationId);
    console.log(`[Socket.io] Socket ${socket.id} joined room: ${conversationId}`);
  });

  socket.on('send_message', async (data) => {
    // Human receptionist sends a message manually
    const { conversationId, message, phone } = data;
    try {
      await supabase.from('chat_messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: message,
        message_type: 'text',
        created_at: new Date().toISOString(),
      });

      await sendWhatsAppMessage(phone, message);

      io.to(conversationId).emit('new_message', {
        conversation_id: conversationId,
        role: 'assistant',
        content: message,
        message_type: 'text',
        created_at: new Date().toISOString(),
        sent_by_human: true,
      });
    } catch (err) {
      console.error('[Socket.io] send_message error:', err.message);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('toggle_ai_mode', async (data) => {
    const { conversationId, aiMode } = data;
    try {
      await supabase
        .from('conversations')
        .update({ ai_mode: aiMode })
        .eq('id', conversationId);

      io.to(conversationId).emit('ai_mode_changed', { conversationId, aiMode });
    } catch (err) {
      console.error('[Socket.io] toggle_ai_mode error:', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// ─── Helper: Get Connection Status ───────────────────────────────────────────
async function getConnectionStatus() {
  const status = { meta: false, calendar: false, sheets: false };

  // Test Meta API
  try {
    await axios.get(
      `${META_GRAPH_URL}/${process.env.META_PHONE_NUMBER_ID}`,
      { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } }
    );
    status.meta = true;
  } catch {}

  // Test Google Calendar
  try {
    const calendar = getCalendarClient();
    const settings = await getClinicSettings();
    await calendar.calendarList.get({
      calendarId: settings.google_calendar_id || process.env.GOOGLE_CALENDAR_ID || 'primary',
    });
    status.calendar = true;
  } catch {}

  // Test Google Sheets
  try {
    const sheets = getSheetsClient();
    const settings = await getClinicSettings();
    const sheetId = settings.google_sheet_id || process.env.GOOGLE_SHEET_ID;
    if (sheetId) {
      await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      status.sheets = true;
    }
  } catch {}

  return status;
}

// ─── Webhook: GET /webhook (Verification) ────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('[Webhook] Verification successful');
    return res.status(200).send(challenge);
  }
  console.warn('[Webhook] Verification failed — token mismatch');
  return res.sendStatus(403);
});

// ─── Webhook: POST /webhook (Incoming Messages) ───────────────────────────────
app.post('/webhook', async (req, res) => {
  // Always respond 200 immediately (WhatsApp requires fast response)
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    if (!value?.messages?.length) return;

    const rawMessage = value.messages[0];
    const message_id = rawMessage.id;
    const from = rawMessage.from; // sender's phone number
    const type = rawMessage.type; // text | image | audio | ...

    // ── Deduplication ──────────────────────────────────────────────────────
    const { data: existing } = await supabase
      .from('processed_messages')
      .select('message_id')
      .eq('message_id', message_id)
      .maybeSingle();

    if (existing) {
      console.log(`[Webhook] Duplicate message skipped: ${message_id}`);
      return;
    }

    // Insert into processed_messages (TTL handled by Supabase scheduled cleanup or pg_cron)
    await supabase.from('processed_messages').insert({ message_id, created_at: new Date().toISOString() });

    // ── Extract message body ───────────────────────────────────────────────
    let messageText = '';
    let imageUrl = null;

    if (type === 'text') {
      messageText = rawMessage.text?.body || '';
    } else if (type === 'image') {
      const mediaId = rawMessage.image?.id;
      messageText = rawMessage.image?.caption || '';
      // Retrieve media URL from Meta
      try {
        const mediaRes = await axios.get(`${META_GRAPH_URL}/${mediaId}`, {
          headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
        });
        imageUrl = mediaRes.data.url;
      } catch (err) {
        console.error('[Webhook] Media URL fetch error:', err.message);
      }
    } else if (type === 'audio') {
      messageText = '[Patient sent an audio message]';
    } else if (type === 'document') {
      messageText = `[Patient sent a document: ${rawMessage.document?.filename || 'file'}]`;
    } else {
      messageText = `[Patient sent a ${type} message]`;
    }

    // ── Get or Create Conversation ─────────────────────────────────────────
    let conversationId;
    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id, ai_mode')
      .eq('patient_phone', from)
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
      // Update last_message_at
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId);
    } else {
      const { data: newConv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          patient_phone: from,
          ai_mode: true,
          created_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (convErr) {
        console.error('[Webhook] Create conversation error:', convErr.message);
        return;
      }
      conversationId = newConv.id;
    }

    // ── Save incoming message to chat_messages ─────────────────────────────
    const incomingMsg = {
      conversation_id: conversationId,
      role: 'user',
      content: messageText,
      message_type: type,
      image_url: imageUrl,
      whatsapp_message_id: message_id,
      created_at: new Date().toISOString(),
    };
    await supabase.from('chat_messages').insert(incomingMsg);

    // Emit incoming message to socket room
    io.to(conversationId).emit('new_message', incomingMsg);

    // ── Check AI mode ──────────────────────────────────────────────────────
    const { data: convData } = await supabase
      .from('conversations')
      .select('ai_mode')
      .eq('id', conversationId)
      .single();

    const aiModeActive = convData?.ai_mode !== false;

    if (!aiModeActive) {
      console.log(`[Webhook] Human mode active for conversation ${conversationId}. No AI response.`);
      return;
    }

    // ── Process with Gemini AI ─────────────────────────────────────────────
    console.log(`[Webhook] Processing message with Gemini for conversation ${conversationId}`);
    await processWithGemini(conversationId, from, messageText, type, imageUrl);
  } catch (err) {
    console.error('[Webhook] POST handler error:', err.message, err.stack);
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────

// GET /api/status — Connection status for Meta, Calendar, Sheets
app.get('/api/status', async (req, res) => {
  try {
    const status = await getConnectionStatus();
    res.json(status);
  } catch (err) {
    console.error('[/api/status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings — Update clinic settings in Supabase
app.post('/api/settings', async (req, res) => {
  try {
    const settings = req.body;

    // Check if settings row exists
    const { data: existing } = await supabase
      .from('clinic_settings')
      .select('id')
      .limit(1)
      .single();

    let result;
    if (existing) {
      result = await supabase
        .from('clinic_settings')
        .update({ ...settings, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('clinic_settings')
        .insert({ ...settings, created_at: new Date().toISOString() })
        .select()
        .single();
    }

    if (result.error) throw result.error;
    res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('[/api/settings]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sheets/setup — Create Google Sheets tabs with headers
app.post('/api/sheets/setup', async (req, res) => {
  try {
    const settings = await getClinicSettings();
    const sheetId = settings.google_sheet_id || process.env.GOOGLE_SHEET_ID;
    if (!sheetId) {
      return res.status(400).json({ error: 'Google Sheet ID not configured' });
    }

    const sheets = getSheetsClient();

    // Get existing sheets
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const existingSheets = spreadsheet.data.sheets.map((s) => s.properties.title);

    const requests = [];

    if (!existingSheets.includes('Appointments')) {
      requests.push({ addSheet: { properties: { title: 'Appointments' } } });
    }
    if (!existingSheets.includes('Patients_Leads')) {
      requests.push({ addSheet: { properties: { title: 'Patients_Leads' } } });
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests },
      });
    }

    // Write headers
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Appointments!A1:H1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Booking ID', 'Date', 'Time Slot', 'Patient Name', 'Phone Number', 'Dental Issue', 'Status', 'Created Timestamp']],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Patients_Leads!A1:D1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Patient Name', 'WhatsApp Number', 'First Contact Date', 'Last Query Summary']],
      },
    });

    res.json({ success: true, message: 'Google Sheets tabs created with headers' });
  } catch (err) {
    console.error('[/api/sheets/setup]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations — List all conversations with last message
app.get('/api/conversations', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        chat_messages (
          content,
          role,
          created_at,
          message_type
        )
      `)
      .order('last_message_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Attach only last message per conversation
    const conversations = (data || []).map((conv) => {
      const messages = conv.chat_messages || [];
      const lastMessage = messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      return { ...conv, last_message: lastMessage, chat_messages: undefined };
    });

    res.json(conversations);
  } catch (err) {
    console.error('[/api/conversations]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:id/messages — Paginated messages
app.get('/api/conversations/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact' })
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json({ messages: data || [], total: count, page, limit });
  } catch (err) {
    console.error('[/api/conversations/:id/messages]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations/:id/toggle-ai — Toggle AI mode
app.post('/api/conversations/:id/toggle-ai', async (req, res) => {
  try {
    const { id } = req.params;
    const { ai_mode } = req.body;

    const { data, error } = await supabase
      .from('conversations')
      .update({ ai_mode })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    io.to(id).emit('ai_mode_changed', { conversationId: id, aiMode: ai_mode });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[/api/conversations/:id/toggle-ai]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/send-message — Human receptionist sends a message
app.post('/api/send-message', async (req, res) => {
  try {
    const { conversationId, message, phone } = req.body;
    if (!conversationId || !message || !phone) {
      return res.status(400).json({ error: 'conversationId, message, and phone are required' });
    }

    const msgRecord = {
      conversation_id: conversationId,
      role: 'assistant',
      content: message,
      message_type: 'text',
      sent_by_human: true,
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('chat_messages').insert(msgRecord);
    if (error) throw error;

    await sendWhatsAppMessage(phone, message);

    io.to(conversationId).emit('new_message', msgRecord);

    // Update last_message_at on conversation
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    res.json({ success: true });
  } catch (err) {
    console.error('[/api/send-message]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/simulate — Local test simulator
app.post('/api/chat/simulate', async (req, res) => {
  try {
    const { message, patientName = 'Rahul Sharma', conversationId } = req.body;
    let phone = (req.body.phone || '+919876543210').trim();

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    let conv = null;
    if (conversationId) {
      const { data } = await supabase.from('conversations').select('*').eq('id', conversationId).maybeSingle();
      if (data) {
        conv = data;
        phone = data.phone_number;
      }
    }

    if (!conv) {
      const { data } = await supabase.from('conversations').select('*').eq('phone_number', phone).maybeSingle();
      if (data) conv = data;
    }

    if (!conv) {
      const { data: newConv, error: err } = await supabase
        .from('conversations')
        .insert({
          phone_number: phone,
          patient_name: patientName,
          ai_mode: true,
          last_message: message.trim(),
          last_message_at: new Date().toISOString(),
          unread_count: 0,
        })
        .select()
        .single();
      if (err) throw err;
      conv = newConv;
    }

    const userMsgRecord = {
      conversation_id: conv.id,
      role: 'user',
      content: message.trim(),
      message_type: 'text',
      created_at: new Date().toISOString(),
    };
    await supabase.from('chat_messages').insert(userMsgRecord);
    io.to(conv.id).emit('new_message', userMsgRecord);

    const reply = await processWithGemini(conv.id, phone, message.trim(), 'text', null);

    const aiMsgRecord = {
      conversation_id: conv.id,
      role: 'assistant',
      content: reply,
      message_type: 'text',
      created_at: new Date().toISOString(),
    };
    await supabase.from('chat_messages').insert(aiMsgRecord);
    io.to(conv.id).emit('new_message', aiMsgRecord);

    await supabase
      .from('conversations')
      .update({
        last_message: reply,
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      })
      .eq('id', conv.id);

    res.json({
      success: true,
      conversationId: conv.id,
      phone,
      patientName: conv.patient_name || patientName,
      userMessage: userMsgRecord,
      aiReply: aiMsgRecord,
      replyText: reply,
    });
  } catch (err) {
    console.error('[/api/chat/simulate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload-kb — Upload PDF/text for RAG context
app.post('/api/upload-kb', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, mimetype, size, path: tmpPath } = req.file;

    // Read file content for text files
    let content = null;
    if (mimetype === 'text/plain') {
      content = fs.readFileSync(tmpPath, 'utf8');
    }

    // Try uploading to Supabase storage
    let storageUrl = null;
    try {
      const fileBuffer = fs.readFileSync(tmpPath);
      const storageKey = `kb/${Date.now()}-${originalname}`;
      const { data: storageData, error: storageErr } = await supabase.storage
        .from('knowledge-base')
        .upload(storageKey, fileBuffer, { contentType: mimetype });

      if (!storageErr && storageData) {
        const { data: publicUrl } = supabase.storage
          .from('knowledge-base')
          .getPublicUrl(storageKey);
        storageUrl = publicUrl?.publicUrl;
      }
    } catch (storageEx) {
      console.warn('[upload-kb] Supabase storage error:', storageEx.message);
      // Keep file locally if storage fails
    }

    // Save metadata to Supabase
    const { data: kbRecord, error: kbErr } = await supabase
      .from('knowledge_base')
      .insert({
        filename: originalname,
        mimetype,
        size,
        storage_url: storageUrl,
        content: content?.substring(0, 10000), // Store first 10k chars inline
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (kbErr) {
      console.warn('[upload-kb] DB insert error:', kbErr.message);
    }

    // Clean up temp file if uploaded to storage
    if (storageUrl) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }

    res.json({
      success: true,
      filename: originalname,
      storage_url: storageUrl,
      id: kbRecord?.id,
    });
  } catch (err) {
    console.error('[/api/upload-kb]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🦷 WhatsApp AI Dental Receptionist Server`);
  console.log(`   Server running on port ${PORT}`);
  console.log(`   Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`   Frontend:    ${CLIENT_URL}\n`);
});

export default app;
