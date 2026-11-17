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

// ─── Process Error Guards ───────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('💥 [UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 [UNHANDLED REJECTION]', reason);
});

// ─── Load .env.local from parent directory ───────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env.local') });

// ─── Constants ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_CLIENT_URL || 'http://localhost:3000';
const META_GRAPH_URL = 'https://graph.facebook.com/v19.0';

// ─── Dynamic CORS Configuration for Vercel & Cloud Deployments ───────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.NEXT_PUBLIC_CLIENT_URL,
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean);

const isOriginAllowed = (origin) => {
  if (!origin) return true; // allow non-browser requests (Meta webhooks, curl, Postman, health checks)
  if (process.env.FRONTEND_URL === '*' || process.env.CORS_ORIGIN === '*') return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    if (hostname.endsWith('.vercel.app')) return true; // Allow any Vercel deployment preview or production domain
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  } catch {}
  return true; // Permissive fallback for socket.io & CORS in production
};

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
    origin: (origin, callback) => {
      callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (process.env.FRONTEND_URL && process.env.FRONTEND_URL !== '*') {
    res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
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
  // 1. Check for entire JSON in environment variables (Render / Vercel cloud environments)
  const envJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDENTIALS_JSON;
  if (envJson && envJson.trim()) {
    try {
      const parsed = typeof envJson === 'string' ? JSON.parse(envJson) : envJson;
      if (parsed.client_email && (parsed.private_key || parsed.privateKey)) {
        let rawKey = parsed.private_key || parsed.privateKey || '';
        if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
          rawKey = rawKey.slice(1, -1);
        }
        const privateKey = rawKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
        return new google.auth.GoogleAuth({
          credentials: { client_email: parsed.client_email, private_key: privateKey },
          scopes: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/spreadsheets',
          ],
        });
      }
    } catch (e) {
      console.warn('[getGoogleAuthClient] Error parsing GOOGLE_SERVICE_ACCOUNT_JSON from env:', e.message);
    }
  }

  // 2. Check local file (dev environment)
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

  // 3. Check individual env variables
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

function getCalendarClient(serviceAccountJson) {
  if (serviceAccountJson && serviceAccountJson.trim()) {
    try {
      const parsed = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
      if (parsed.client_email && (parsed.private_key || parsed.privateKey)) {
        let rawKey = parsed.private_key || parsed.privateKey || '';
        if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
          rawKey = rawKey.slice(1, -1);
        }
        const privateKey = rawKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
        const auth = new google.auth.GoogleAuth({
          credentials: { client_email: parsed.client_email, private_key: privateKey },
          scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/spreadsheets'],
        });
        return google.calendar({ version: 'v3', auth });
      }
    } catch (e) {
      console.warn('[getCalendarClient] Custom service account error:', e.message);
    }
  }
  const auth = getGoogleAuthClient();
  return google.calendar({ version: 'v3', auth });
}

function getSheetsClient(serviceAccountJson) {
  if (serviceAccountJson && serviceAccountJson.trim()) {
    try {
      const parsed = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
      if (parsed.client_email && (parsed.private_key || parsed.privateKey)) {
        let rawKey = parsed.private_key || parsed.privateKey || '';
        if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
          rawKey = rawKey.slice(1, -1);
        }
        const privateKey = rawKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
        const auth = new google.auth.GoogleAuth({
          credentials: { client_email: parsed.client_email, private_key: privateKey },
          scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/spreadsheets'],
        });
        return google.sheets({ version: 'v4', auth });
      }
    } catch (e) {
      console.warn('[getSheetsClient] Custom service account error:', e.message);
    }
  }
  const auth = getGoogleAuthClient();
  return google.sheets({ version: 'v4', auth });
}

// ─── Helper: Get Clinic Settings & Dynamic Credentials (Cached 30s) ───────────
let cachedClinicSettings = null;
let cachedClinicSettingsExpiry = 0;
const SETTINGS_CACHE_TTL = 30 * 1000; // 30 seconds

function invalidateClinicSettingsCache() {
  cachedClinicSettings = null;
  cachedClinicSettingsExpiry = 0;
  console.log('🔄 [Cache] Dynamic credentials & clinic settings cache cleared.');
}

async function getClinicSettings(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && cachedClinicSettings && now < cachedClinicSettingsExpiry) {
    return cachedClinicSettings;
  }
  try {
    const { data: dbData } = await supabase
      .from('clinic_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    // Also fetch knowledge_base fallback row for dynamic integrations (source_name = 'clinic_integrations')
    let kbMeta = {};
    try {
      const { data: kbRow } = await supabase
        .from('knowledge_base')
        .select('metadata')
        .eq('source_name', 'clinic_integrations')
        .maybeSingle();
      if (kbRow?.metadata) kbMeta = kbRow.metadata;
    } catch {}

    const resolved = {
      ...(dbData || {}),
      meta_access_token:
        dbData?.meta_access_token ||
        kbMeta?.meta_access_token ||
        process.env.WHATSAPP_ACCESS_TOKEN ||
        process.env.META_ACCESS_TOKEN ||
        process.env.META_WHATSAPP_TOKEN ||
        '',
      meta_phone_number_id:
        dbData?.meta_phone_number_id ||
        kbMeta?.meta_phone_number_id ||
        process.env.META_PHONE_NUMBER_ID ||
        process.env.WHATSAPP_PHONE_NUMBER_ID ||
        '',
      meta_verify_token:
        dbData?.meta_verify_token ||
        kbMeta?.meta_verify_token ||
        process.env.META_VERIFY_TOKEN ||
        '',
      google_calendar_id:
        dbData?.google_calendar_id ||
        kbMeta?.google_calendar_id ||
        process.env.GOOGLE_CALENDAR_ID ||
        '',
      google_sheet_id:
        dbData?.google_sheet_id ||
        kbMeta?.google_sheet_id ||
        process.env.GOOGLE_SHEET_ID ||
        '',
      google_service_account_json:
        dbData?.google_service_account_json ||
        kbMeta?.google_service_account_json ||
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
        '',
      gemini_api_key:
        dbData?.gemini_api_key ||
        kbMeta?.gemini_api_key ||
        process.env.GEMINI_API_KEY ||
        '',
      gemini_model:
        dbData?.gemini_model ||
        kbMeta?.gemini_model ||
        process.env.GEMINI_MODEL ||
        'gemini-1.5-flash',
      clinic_name: dbData?.clinic_name || process.env.CLINIC_NAME || 'Dental Care Clinic',
      doctor_name: dbData?.doctor_name || process.env.CLINIC_DOCTOR || 'Dr. Sharma',
      address: dbData?.address || process.env.CLINIC_ADDRESS || '123 Medical Enclave',
      phone: dbData?.phone || process.env.CLINIC_PHONE || '+91 98765 43210',
      timings_start: (dbData?.timings_start || process.env.CLINIC_TIMINGS_START || '09:00').slice(0, 5),
      timings_end: (dbData?.timings_end || process.env.CLINIC_TIMINGS_END || '18:00').slice(0, 5),
      lunch_start: (dbData?.lunch_start || process.env.CLINIC_LUNCH_START || '13:00').slice(0, 5),
      lunch_end: (dbData?.lunch_end || process.env.CLINIC_LUNCH_END || '14:00').slice(0, 5),
      weekly_off: dbData?.weekly_off || process.env.CLINIC_WEEKLY_OFF || 'Sunday',
      consultation_fee: Number(dbData?.consultation_fee ?? process.env.CLINIC_CONSULTATION_FEE ?? 500),
    };

    cachedClinicSettings = resolved;
    cachedClinicSettingsExpiry = now + SETTINGS_CACHE_TTL;
    return resolved;
  } catch (err) {
    console.warn('[getClinicSettings] Error fetching settings:', err.message);
    const fallback = {
      clinic_name: process.env.CLINIC_NAME || 'Dental Clinic',
      doctor_name: process.env.DOCTOR_NAME || 'Doctor',
      address: process.env.CLINIC_ADDRESS || '',
      timings_start: process.env.TIMINGS_START || '09:00',
      timings_end: process.env.TIMINGS_END || '18:00',
      lunch_start: process.env.LUNCH_START || '13:00',
      lunch_end: process.env.LUNCH_END || '14:00',
      weekly_off: process.env.WEEKLY_OFF || 'Sunday',
      consultation_fee: process.env.CONSULTATION_FEE || '500',
      google_calendar_id: process.env.GOOGLE_CALENDAR_ID || '',
      google_sheet_id: process.env.GOOGLE_SHEET_ID || '',
      meta_access_token: process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || '',
      meta_phone_number_id: process.env.META_PHONE_NUMBER_ID || '',
      meta_verify_token: process.env.META_VERIFY_TOKEN || '',
      gemini_api_key: process.env.GEMINI_API_KEY || '',
    };
    cachedClinicSettings = fallback;
    cachedClinicSettingsExpiry = now + SETTINGS_CACHE_TTL;
    return fallback;
  }
}

// ─── Timeout Promise Guard ───────────────────────────────────────────────────
function withTimeout(promise, ms = 4000, errorMsg = 'Operation timed out') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

// ─── Fast-Path Greeting Detection ───────────────────────────────────────────
const GREETING_WORDS = new Set([
  'hi', 'hii', 'hiii', 'hello', 'helloo', 'hey', 'heyy',
  'namaste', 'namaskar', 'halo', 'hola', 'good morning',
  'good afternoon', 'good evening', 'greetings', 'start'
]);

function isBasicGreeting(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text
    .trim()
    .toLowerCase()
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0F}]/gu, '')
    .replace(/[!?.,:;~@#$%^&*()_+={}\[\]|\\<>\/`"'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return GREETING_WORDS.has(clean);
}

// ─── Dual-Layer Message Deduplication (In-Memory 1-Hour TTL + Persistent Supabase) ───
const processedMessageIds = new Set();

function isMemoryDuplicate(messageId) {
  if (!messageId) return true;
  if (processedMessageIds.has(messageId)) {
    return true;
  }
  processedMessageIds.add(messageId);
  setTimeout(() => {
    processedMessageIds.delete(messageId);
  }, 60 * 60 * 1000); // Retain in memory for 1 hour to block fast retries
  return false;
}

async function isMessageAlreadyInDb(messageId) {
  if (!messageId) return true;
  try {
    const { data } = await supabase
      .from('processed_messages')
      .select('message_id')
      .eq('message_id', messageId)
      .maybeSingle();
    return Boolean(data?.message_id);
  } catch (err) {
    console.warn('[Dedup DB Check Warning]:', err.message);
    return false;
  }
}

function markMessageProcessedInDb(messageId) {
  if (!messageId) return;
  Promise.resolve(
    supabase.from('processed_messages').insert({
      message_id: messageId,
      processed_at: new Date().toISOString(),
    })
  ).catch(() => {});
}

// ─── Simple Post-Booking Acknowledgment Detection ───────────────────────────
function isSimpleAcknowledgment(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (/^[\p{Emoji}\s]+$/u.test(raw) && /[\u{1F44D}\u{1F60A}\u{1F64F}\u{1F91D}\u{2705}\u{2728}]/u.test(raw)) {
    return true;
  }
  const clean = raw
    .toLowerCase()
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0F}]/gu, '')
    .replace(/[!?.,:;~@#$%^&*()_+={}\[\]|\\<>\/`"'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const ACK_SET = new Set([
    'ok', 'okay', 'okk', 'okey', 'k', 'kk',
    'thanks', 'thank you', 'thank u', 'thx', 'tq', 'thankyou',
    'theek hai', 'theek h', 'thik hai', 'thik h', 'thek hai', 'thek h',
    'sahi hai', 'sahi h', 'shukriya', 'dhanyawad',
    'done', 'great', 'perfect', 'alright', 'all right',
    'see you', 'see u', 'got it', 'sure', 'yes', 'haan', 'ha'
  ]);

  return ACK_SET.has(clean);
}

// ─── Programmatic Weekday Calculation (No LLM Guessing) ─────────────────────
function getExactWeekday(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return '';
  const [year, month, day] = parts;
  return new Date(year, month - 1, day, 12, 0, 0).toLocaleDateString('en-US', { weekday: 'long' });
}

async function getMetaAccessToken() {
  const settings = await getClinicSettings();
  return settings.meta_access_token || process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN || '';
}

async function getMetaPhoneNumberId() {
  const settings = await getClinicSettings();
  return settings.meta_phone_number_id || process.env.META_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
}

// ─── Canonical Phone Normalization & Unified Conversation Thread ───────────
function normalizePhoneNumber(rawPhone) {
  if (!rawPhone) return '';
  let digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    digits = `91${digits}`;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = `91${digits.slice(1)}`;
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  return digits;
}

async function getOrCreateConversation(phoneInput, patientNameInput, lastMessageText, isAIMode = true) {
  const normPhone = normalizePhoneNumber(phoneInput);
  if (!normPhone) return null;

  try {
    // 1. Look up by normalized digits or legacy format (+91...)
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .or(`phone_number.eq.${normPhone},phone_number.eq.+${normPhone}`)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const updates = {
        phone_number: normPhone, // Ensure legacy number is updated to normalized digits
        last_message: lastMessageText || existing.last_message,
        last_message_at: new Date().toISOString(),
      };
      if (patientNameInput && (!existing.patient_name || existing.patient_name === 'Patient' || existing.patient_name === 'Rahul Sharma')) {
        updates.patient_name = patientNameInput;
      }
      const { data: updated } = await supabase
        .from('conversations')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();
      return updated || existing;
    }

    // 2. Upsert using onConflict: 'phone_number' to guarantee NO duplicate rows ever
    const { data: upserted, error: upsertErr } = await supabase
      .from('conversations')
      .upsert(
        {
          phone_number: normPhone,
          patient_name: patientNameInput || '',
          last_message: lastMessageText || '',
          last_message_at: new Date().toISOString(),
          ai_mode: isAIMode,
          unread_count: 1,
        },
        { onConflict: 'phone_number' }
      )
      .select()
      .single();

    if (upsertErr) {
      console.warn('[getOrCreateConversation upsert warning]:', upsertErr.message);
      const { data: fallback } = await supabase
        .from('conversations')
        .select('*')
        .eq('phone_number', normPhone)
        .maybeSingle();
      return fallback;
    }
    return upserted;
  } catch (err) {
    console.error('[getOrCreateConversation error]:', err.message);
    return null;
  }
}

// ─── Helper: Send WhatsApp Message ───────────────────────────────────────────
async function sendWhatsAppMessage(phone, text) {
  try {
    const messageBody = text ? text.trim() : '';
    const cleanPhone = normalizePhoneNumber(phone);
    const phoneId = await getMetaPhoneNumberId();
    const token = await getMetaAccessToken();
    const url = `${META_GRAPH_URL}/${phoneId}/messages`;
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: { preview_url: false, body: messageBody },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
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

// ─── Real-Time Date & Natural Language Helpers ─────────────────────────────────
function stripEmojis(text) {
  if (!text) return '';
  return text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0F}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const MONTH_NAMES = {
  jan: { m: 1, name: 'January' }, january: { m: 1, name: 'January' },
  feb: { m: 2, name: 'February' }, february: { m: 2, name: 'February' }, februrary: { m: 2, name: 'February' },
  mar: { m: 3, name: 'March' }, march: { m: 3, name: 'March' },
  apr: { m: 4, name: 'April' }, april: { m: 4, name: 'April' },
  may: { m: 5, name: 'May' },
  jun: { m: 6, name: 'June' }, june: { m: 6, name: 'June' },
  jul: { m: 7, name: 'July' }, july: { m: 7, name: 'July' },
  aug: { m: 8, name: 'August' }, august: { m: 8, name: 'August' },
  sep: { m: 9, name: 'September' }, sept: { m: 9, name: 'September' }, september: { m: 9, name: 'September' },
  oct: { m: 10, name: 'October' }, october: { m: 10, name: 'October' },
  nov: { m: 11, name: 'November' }, novmber: { m: 11, name: 'November' }, november: { m: 11, name: 'November' },
  dec: { m: 12, name: 'December' }, decembr: { m: 12, name: 'December' }, december: { m: 12, name: 'December' },
};

function getDaysInMonth(year, month) {
  // month is 1-based (1 = Jan, 12 = Dec)
  return new Date(year, month, 0).getDate();
}

function getRealtimeDateContext() {
  const now = new Date();
  const timeZone = 'Asia/Kolkata';
  const todayStr = now.toLocaleDateString('en-CA', { timeZone });
  const todayWeekday = now.toLocaleDateString('en-US', { weekday: 'long', timeZone });
  const todayFormatted = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  });
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone });
  const tomorrowWeekday = tomorrow.toLocaleDateString('en-US', { weekday: 'long', timeZone });
  const tomorrowFormatted = tomorrow.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  });
  const currentTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone });
  const [y, m, d] = todayStr.split('-').map(Number);
  const monthName = now.toLocaleDateString('en-US', { month: 'long', timeZone });
  return {
    todayStr,
    todayWeekday,
    todayFormatted,
    tomorrowStr,
    tomorrowWeekday,
    tomorrowFormatted,
    currentTime,
    year: y,
    month: m,
    day: d,
    monthName,
  };
}

function resolveAndValidateDate(input) {
  if (!input) return { valid: false, error: 'empty_input' };
  const str = String(input).trim().toLowerCase();
  const ctx = getRealtimeDateContext();

  // Reject phone numbers passed as dates, but never reject formatted dates (YYYY-MM-DD, DD/MM/YYYY)
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(str) && !/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(str)) {
    const cleanDigits = str.replace(/[\s()+]/g, '');
    if (/^[6-9]\d{9}$/.test(cleanDigits) || (/^(91)?\d{10}$/.test(cleanDigits) && !str.includes('-') && !str.includes('/'))) {
      return { valid: false, error: 'phone_number', message: 'A phone number was provided instead of a date.' };
    }
  }

  // 1. Relative dates: today, tomorrow, day after tomorrow
  if (['today', '2day', 'tday', 'aaj', 'aj'].includes(str)) {
    return { valid: true, date: ctx.todayStr };
  }
  if (['tomorrow', 'tomorow', 'tommorrow', 'tomrw', 'tmrw', 'tmr', 'kal', 'kl'].includes(str)) {
    return { valid: true, date: ctx.tomorrowStr };
  }
  if (['day after tomorrow', 'day after tomorow', 'day after tmrw', 'parso', 'parson'].includes(str)) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    const date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return { valid: true, date };
  }

  // 2. Weekdays (e.g. "monday", "next monday", "this tuesday", "somwar", etc.)
  const weekdays = {
    sunday: 0, sun: 0, itwar: 0, ravivar: 0,
    monday: 1, mon: 1, somwar: 1,
    tuesday: 2, tue: 2, mangalwar: 2,
    wednesday: 3, wed: 3, budhwar: 3,
    thursday: 4, thu: 4, guruwar: 4, brihaspatiwar: 4,
    friday: 5, fri: 5, shukrawar: 5,
    saturday: 6, sat: 6, shaniwar: 6,
  };
  const cleanWeekday = str.replace(/^(this|next|coming)\s+/, '').trim();
  if (weekdays[cleanWeekday] !== undefined) {
    const targetDay = weekdays[cleanWeekday];
    const now = new Date();
    const currentDay = now.getDay();
    let diff = targetDay - currentDay;
    if (diff <= 0) diff += 7;
    const targetDate = new Date(now.getTime() + diff * 24 * 60 * 60 * 1000);
    const date = targetDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return { valid: true, date };
  }

  let year = ctx.year;
  let month = ctx.month; // 1-12
  let day = null;
  let monthName = ctx.monthName;

  // 3. YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    year = parseInt(ymdMatch[1], 10);
    month = parseInt(ymdMatch[2], 10);
    day = parseInt(ymdMatch[3], 10);
    monthName = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long' });
  }

  // 4. DD/MM/YYYY or DD-MM-YYYY
  if (!day) {
    const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmyMatch) {
      day = parseInt(dmyMatch[1], 10);
      month = parseInt(dmyMatch[2], 10);
      year = parseInt(dmyMatch[3], 10);
      monthName = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long' });
    }
  }

  // 5. Match "15th Nov", "15 November", "15th November 2026", "31st Nov"
  if (!day) {
    const match1 = str.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/);
    if (match1) {
      day = parseInt(match1[1], 10);
      const mKey = match1[2].slice(0, 3);
      const mObj = MONTH_NAMES[mKey] || MONTH_NAMES[match1[2]];
      if (mObj) {
        month = mObj.m || mObj;
        monthName = mObj.name || match1[2];
      }
      if (match1[3]) year = parseInt(match1[3], 10);
    }
  }

  // 6. Match "Nov 15", "November 15th", "Nov 31"
  if (!day) {
    const match2 = str.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/);
    if (match2) {
      const mKey = match2[1].slice(0, 3);
      const mObj = MONTH_NAMES[mKey] || MONTH_NAMES[match2[1]];
      if (mObj) {
        month = mObj.m || mObj;
        monthName = mObj.name || match2[1];
      }
      day = parseInt(match2[2], 10);
      if (match2[3]) year = parseInt(match2[3], 10);
    }
  }

  // 7. Standalone day in current month: "31st", "17th", "31", "17"
  if (!day) {
    const match3 = str.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
    if (match3) {
      day = parseInt(match3[1], 10);
      // month and year default to current month and year
    }
  }

  if (day !== null && month >= 1 && month <= 12) {
    const maxDays = getDaysInMonth(year, month);
    if (day < 1 || day > maxDays) {
      return {
        valid: false,
        error: 'invalid_day_in_month',
        day,
        month,
        monthName,
        maxDays,
        message_en: `${monthName} only has ${maxDays} days, so ${input} is not a valid date. Could you please choose a valid upcoming date? 📅`,
        message_hi: `${monthName} mein sirf ${maxDays} din hote hain, isliye ${input} valid date nahi hai. Kripya koi valid aane wali date batayein? 📅`,
      };
    }

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (dateStr < ctx.todayStr) {
      return {
        valid: false,
        error: 'past_date',
        date: dateStr,
        todayStr: ctx.todayStr,
        message_en: `That date (${dateStr}) has already passed (Today is ${ctx.todayFormatted}). Please choose today, tomorrow, or an upcoming date! 📅`,
        message_hi: `Yeh date (${dateStr}) nikal chuki hai (Aaj ${ctx.todayFormatted} hai). Kripya aaj, kal ya koi aane wali date batayein! 📅`,
      };
    }

    return { valid: true, date: dateStr };
  }

  return { valid: false, error: 'unparseable', input };
}

function normalizeDate(input) {
  const result = resolveAndValidateDate(input);
  return result.valid ? result.date : null;
}

function normalizeSlotTime(input) {
  if (!input) return null;
  const str = String(input).trim().toLowerCase();

  // 1. Pure phone numbers or long digit sequences (7 to 13 digits) must NEVER be parsed as a time slot
  const digitsOnly = str.replace(/\D/g, '');
  if (digitsOnly.length >= 7) return null;

  // 2. Reject 3 or more digits without a colon, am, or pm (e.g. 738, 987, 1000)
  if (!str.includes(':') && !str.includes('am') && !str.includes('pm') && digitsOnly.length > 2) {
    return null;
  }

  // 3. Already HH:MM format
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(str)) return str;

  // 4. Descriptive phrases
  if (str.includes('after 12') || str.includes('12 am') || str.includes('afternoon') || str.includes('dophar')) {
    return '14:00';
  }

  // 5. Time matching: 12pm, 12:30pm, 10am, 2 pm, etc.
  const match = str.match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/i);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = match[2] ? match[2] : '00';
    const ampm = match[3] ? match[3].toLowerCase() : null;

    // Reject standalone numbers that cannot be clinic hours (e.g., 73, 99, 14 without am/pm)
    if (!ampm && (hour < 8 || hour > 20)) {
      return null;
    }

    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (!ampm && hour >= 1 && hour <= 6) hour += 12;

    if (hour >= 0 && hour <= 23) {
      return `${String(hour).padStart(2, '0')}:${minute}`;
    }
  }

  return null;
}

function extractResponseText(resp) {
  if (!resp) return '';
  try {
    const txt = resp.text();
    if (txt && typeof txt === 'string' && txt.trim()) {
      return txt.trim();
    }
  } catch (e) {}

  try {
    const candidates = resp.candidates || [];
    for (const cand of candidates) {
      const parts = cand.content?.parts || [];
      for (const part of parts) {
        if (part.text && typeof part.text === 'string' && part.text.trim()) {
          return part.text.trim();
        }
      }
    }
  } catch (e) {}

  return '';
}

// ─── Google Calendar Cache (60-second TTL & Instant Invalidation on Booking) ───
const calendarCache = new Map();
const CALENDAR_CACHE_TTL = 60 * 1000;

async function getCachedGoogleCalendarBusySlots(date, calendarId) {
  const cached = calendarCache.get(date);
  if (cached && Date.now() < cached.expiry) {
    console.log(`⚡ [Google Calendar Cache HIT] Date ${date} retrieved in <1ms (${cached.busySlots.size} busy slots).`);
    return cached.busySlots;
  }

  const busySlots = new Set();
  const hasValidCalendar =
    calendarId &&
    !calendarId.includes('your_clinic_calendar_id') &&
    !calendarId.includes('your_') &&
    !calendarId.includes('placeholder');

  if (hasValidCalendar) {
    try {
      const calendar = getCalendarClient(settings?.google_service_account_json);
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);

      const eventsRes = await withTimeout(
        calendar.events.list({
          calendarId,
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
        }),
        5000,
        'Calendar lookup timed out'
      );

      const items = eventsRes.data.items || [];
      for (const evt of items) {
        const evtStart = new Date(evt.start?.dateTime || evt.start?.date).getTime();
        const evtEnd = new Date(evt.end?.dateTime || evt.end?.date).getTime();
        if (!isNaN(evtStart) && !isNaN(evtEnd)) {
          for (let h = 8; h <= 20; h++) {
            for (let m = 0; m < 60; m += 30) {
              const slot = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
              const slotTime = new Date(`${date}T${slot}:00`).getTime();
              const slotEndTime = slotTime + 30 * 60 * 1000;
              if (slotTime < evtEnd && slotEndTime > evtStart) {
                busySlots.add(slot);
              }
            }
          }
        }
      }
      calendarCache.set(date, { busySlots, expiry: Date.now() + CALENDAR_CACHE_TTL });
      console.log(`📅 [Google Calendar Cache POPULATED] Date ${date}: ${items.length} events, ${busySlots.size} busy slots.`);
    } catch (calErr) {
      console.warn('[getCachedGoogleCalendarBusySlots] Calendar lookup warning:', calErr.message);
      if (cached) return cached.busySlots;
    }
  }

  return busySlots;
}

function invalidateCalendarCache(date) {
  if (date) {
    calendarCache.delete(date);
    console.log(`🔄 [Google Calendar Cache INVALIDATED] Cache cleared for date: ${date}`);
  }
}

// ─── Helper: Check Availability ──────────────────────────────────────────────
async function checkAvailability(rawDate, settings) {
  try {
    const parsed = resolveAndValidateDate(rawDate);
    const dateCtx = getRealtimeDateContext();

    if (!parsed.valid) {
      if (parsed.error === 'invalid_day_in_month') {
        return {
          available_slots: [],
          date: rawDate,
          is_invalid_date: true,
          error_type: 'invalid_day_in_month',
          reason: parsed.message_en,
          message_en: parsed.message_en,
          message_hi: parsed.message_hi,
        };
      }
      if (parsed.error === 'past_date') {
        return {
          available_slots: [],
          date: parsed.date || rawDate,
          is_past_date: true,
          error_type: 'past_date',
          reason: parsed.message_en,
          message_en: parsed.message_en,
          message_hi: parsed.message_hi,
        };
      }
      console.warn('[checkAvailability] Could not parse date:', rawDate);
      return {
        available_slots: [],
        date: rawDate,
        error: 'Invalid date format. Please specify a valid upcoming date.',
      };
    }

    const date = parsed.date;

    const timingsStart = settings.timings_start || '09:00';
    const timingsEnd = settings.timings_end || '18:00';
    const lunchStart = settings.lunch_start || '13:00';
    const lunchEnd = settings.lunch_end || '14:00';
    const weeklyOff = settings.weekly_off || 'Sunday';

    // 1. Check weekly off
    const dayOfWeek = getExactWeekday(date);

    if (weeklyOff && weeklyOff.toLowerCase() !== 'none' && dayOfWeek.toLowerCase() === weeklyOff.toLowerCase()) {
      return {
        available_slots: [],
        date,
        day_of_week: dayOfWeek,
        is_off_day: true,
        reason: `The clinic is closed on ${weeklyOff}s (${date} is ${dayOfWeek}).`,
      };
    }

    // 2. Generate all standard 30-min working slots between timings_start and timings_end
    const [startH, startM] = timingsStart.split(':').map(Number);
    const [endH, endM] = timingsEnd.split(':').map(Number);
    const [lunchStartH, lunchStartM] = lunchStart.split(':').map(Number);
    const [lunchEndH, lunchEndM] = lunchEnd.split(':').map(Number);

    const startMinutes = startH * 60 + (startM || 0);
    const endMinutes = endH * 60 + (endM || 0);
    const lunchStartMinutes = lunchStartH * 60 + (lunchStartM || 0);
    const lunchEndMinutes = lunchEndH * 60 + (lunchEndM || 0);

    const allSlots = [];
    for (let m = startMinutes; m + 30 <= endMinutes; m += 30) {
      // Exclude lunch break
      if (m >= lunchStartMinutes && m < lunchEndMinutes) {
        continue;
      }
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      allSlots.push(`${hh}:${mm}`);
    }

    // 3. Busy slots from Google Calendar (via fast in-memory cache)
    const calendarId = settings.google_calendar_id || process.env.GOOGLE_CALENDAR_ID;
    const busySlots = await getCachedGoogleCalendarBusySlots(date, calendarId);

    // 4. Busy slots from Supabase appointments table
    try {
      const { data: bookedRows, error: dbErr } = await supabase
        .from('appointments')
        .select('time_slot')
        .eq('appointment_date', date)
        .neq('status', 'Cancelled');

      if (!dbErr && bookedRows) {
        for (const row of bookedRows) {
          const cleanSlot = row.time_slot.trim().split(' ')[0];
          busySlots.add(cleanSlot);
        }
      }
    } catch (dbErr) {
      console.warn('[checkAvailability] Supabase appointments lookup failed:', dbErr.message);
    }

    // 5. If date is TODAY, filter out slots that have already passed
    let filteredSlots = allSlots.filter((slot) => !busySlots.has(slot));
    let note = undefined;

    if (date === dateCtx.todayStr) {
      const [currH, currM] = dateCtx.currentTime.split(':').map(Number);
      const currentTotalMinutes = currH * 60 + currM;
      filteredSlots = filteredSlots.filter((slot) => {
        const [sh, sm] = slot.split(':').map(Number);
        return (sh * 60 + sm) > currentTotalMinutes + 15;
      });

      if (filteredSlots.length === 0) {
        note = `All appointment slots for today (${date}) have already passed (Current time: ${dateCtx.currentTime}, clinic closes at ${timingsEnd}). Please book for tomorrow or an upcoming date.`;
      }
    }

    return {
      available_slots: filteredSlots,
      date,
      day_of_week: dayOfWeek,
      is_off_day: false,
      total_open: filteredSlots.length,
      note,
    };
  } catch (err) {
    console.error('[checkAvailability] Error:', err.message);
    return {
      available_slots: ['09:30', '10:00', '11:00', '11:30', '14:30', '15:00', '16:00', '16:30', '17:00'],
      date: rawDate,
      day_of_week: '',
      is_off_day: false,
      total_open: 9,
    };
  }
}

// ─── Helper: Book Appointment ─────────────────────────────────────────────────
async function bookAppointmentAction(params, settings) {
  const { patient_name, patient_phone, dental_issue, date: rawDate, time_slot, visit_type } = params;
  const date = normalizeDate(rawDate);
  const contactPhone = patient_phone || params.senderPhone || 'Not provided';
  const visitTypeLabel = visit_type === 'returning' ? 'Regular Patient' : 'First-time Patient';

  // Re-verify slot is still free
  const avail = await checkAvailability(date, settings);
  const openSlots = avail.available_slots || [];

  if (avail.is_off_day) {
    return {
      success: false,
      message: avail.reason || `The clinic is closed on ${date}.`,
    };
  }

  if (!openSlots.includes(time_slot)) {
    if (openSlots.length === 0) {
      return {
        success: false,
        message: avail.note || `Sorry, there are no available slots on ${date}. Please choose another date.`,
      };
    }
    return {
      success: false,
      message: `Sorry, the slot ${time_slot} on ${date} is no longer available. Available slots: ${openSlots.slice(0, 6).join(', ')}`,
    };
  }

  const bookingId = `BK-${uuidv4().slice(0, 8).toUpperCase()}`;
  const startDateTime = new Date(`${date}T${time_slot}:00`);
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);
  const timestamp = new Date().toISOString();
  const calendarId = settings.google_calendar_id || process.env.GOOGLE_CALENDAR_ID;
  const sheetId = settings.google_sheet_id || process.env.GOOGLE_SHEET_ID;

  // Immediately invalidate calendar cache so newly booked slot is blocked
  invalidateCalendarCache(date);

  // Background non-blocking sync for Google Calendar, Google Sheets, and Supabase
  // Runs asynchronously without delaying the instant response to the patient!
  (async () => {
    // 1. Create Google Calendar event (if calendar ID is valid)
    const hasValidCalendar =
      calendarId &&
      !calendarId.includes('your_clinic_calendar_id') &&
      !calendarId.includes('your_') &&
      !calendarId.includes('placeholder');

    if (hasValidCalendar) {
      try {
        const calendar = getCalendarClient(settings?.google_service_account_json);
        await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: `${patient_name} (${visitTypeLabel}) - ${dental_issue}`,
            description: `Patient: ${patient_name}\nContact Phone: ${contactPhone}\nWhatsApp: ${params.senderPhone || contactPhone}\nVisit Type: ${visitTypeLabel}\nDental Issue: ${dental_issue}\nBooking ID: ${bookingId}`,
            start: { dateTime: startDateTime.toISOString() },
            end: { dateTime: endDateTime.toISOString() },
          },
        });
        console.log(`📅 [Google Calendar] Successfully created appointment event in calendar "${calendarId}" for ${patient_name}.`);
      } catch (err) {
        console.warn('[bookAppointment Background] Calendar insert warning:', err.message);
      }
    } else {
      console.log(`ℹ️ [Google Calendar] Google Calendar event skipped (placeholder/unset calendarId: ${calendarId}).`);
    }

    // 2. Append to Google Sheets — Appointments tab
    if (sheetId) {
      try {
        const sheets = getSheetsClient(settings?.google_service_account_json);
        await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: 'Appointments!A:H',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[bookingId, date, time_slot, patient_name, contactPhone, `${dental_issue} [${visitTypeLabel}]`, 'Confirmed', timestamp]],
          },
        });
      } catch (err) {
        console.warn('[bookAppointment Background] Sheets Appointments warning:', err.message);
      }

      // 3. Upsert to Google Sheets — Patients_Leads tab
      try {
        const sheets = getSheetsClient(settings?.google_service_account_json);
        const existing = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: 'Patients_Leads!B:B',
        });
        const phones = (existing.data.values || []).flat();
        const rowIndex = phones.indexOf(contactPhone);

        if (rowIndex > 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `Patients_Leads!D${rowIndex + 1}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[`${dental_issue} (${visitTypeLabel})`]] },
          });
        } else {
          await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: 'Patients_Leads!A:D',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[patient_name, contactPhone, date, `${dental_issue} (${visitTypeLabel})`]],
            },
          });
        }
      } catch (err) {
        console.warn('[bookAppointment Background] Sheets Patients_Leads warning:', err.message);
      }
    }

    // 4. Save appointment to Supabase
    try {
      await supabase.from('appointments').insert({
        booking_id: bookingId,
        conversation_id: params.conversationId || null,
        patient_name,
        patient_phone: contactPhone,
        dental_issue: `${dental_issue} (${visitTypeLabel})`,
        appointment_date: date,
        time_slot,
        status: 'Confirmed',
        created_at: timestamp,
      });
    } catch (err) {
      console.warn('[bookAppointment Background] Supabase insert warning:', err.message);
    }
  })().catch((bgErr) => console.error('[bookAppointment Background Sync Error]', bgErr.message));

  const dayOfWeek = getExactWeekday(date);

  return {
    success: true,
    booking_id: bookingId,
    patient_name,
    patient_phone: contactPhone,
    visit_type: visitTypeLabel,
    dental_issue,
    date,
    day_of_week: dayOfWeek,
    time_slot,
    message: `Appointment confirmed! Booking ID: ${bookingId}. Patient: ${patient_name} (${visitTypeLabel}), Contact Phone: ${contactPhone}, Date: ${date} (${dayOfWeek}), Time: ${time_slot}, Issue: ${dental_issue}. IMPORTANT: In your confirmation message, you MUST state the date and day as "${date}, ${dayOfWeek}".`,
  };
}

// ─── In-Memory Conversation State Map (conversationId -> state) ───────────────
const conversationStateMap = new Map();

function formatSlotDisplay(slot) {
  if (!slot) return '12:00 PM';
  const [h, m] = slot.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

const BROAD_HINGLISH_REGEX = /\b(mujhe|mujhko|meko|mereko|mera|meri|mere|aap|aapko|aapka|aapki|aapke|hum|humko|hai|hain|h|ho|hoon|hun|ka|ki|ke|ko|me|mein|se|par|pe|kya|kab|kaise|kitna|kitni|kitne|kal|aaj|parso|dard|daat|daant|teeth|karna|krna|karwana|krwana|chahiye|batao|btao|bataiye|nahi|nhi|haan|ha|ji|bhai|sir|theek|thik|dophar|sham|subah|bohot|bahut|zyada|jyada|kam|hoga|hogi|honge|mil|sakta|sakti|milenge|kripya|namaste)\b|[\u0900-\u097F]/i;

function updateStateFromMessage(state, messageText) {
  if (!messageText || typeof messageText !== 'string') return;
  const lower = messageText.toLowerCase().trim();

  // 1. Natural language detection (Hinglish vs. English)
  if (BROAD_HINGLISH_REGEX.test(messageText)) {
    state.language = 'hinglish';
  } else if (/\b(i|my|we|you|the|is|are|am|have|has|need|want|please|schedule|appointment|book|doctor|cleaning|pain|tooth|teeth|tomorrow|today)\b/i.test(messageText)) {
    state.language = 'en';
  }

  // Check for reschedule or new appointment intent
  const isReschedule = /\b(reschedule|change\s*time|change\s*date|different\s*time|different\s*date|timing\s*badal|dusra\s*time|dusri\s*date|book\s*another|naya\s*appointment)\b/i.test(messageText);
  if (state.is_booked) {
    if (isReschedule) {
      console.log(`🔄 [Reschedule Requested] Resetting booked flag for reschedule`);
      state.is_booked = false;
    } else {
      // If already booked and NOT rescheduling, keep all booking fields locked and exit
      state.last_updated = Date.now();
      return;
    }
  }

  // 2. Dental issue extraction
  if (!state.dental_issue) {
    const issueMatch = messageText.match(/\b(tooth\s*pain|teeth\s*pain|toothache|teethache|dental\s*pain|cavity|cavities|cleaning|scaling|teeth\s*cleaning|whitening|rct|root\s*canal|braces|extraction|implant|implants|bleeding\s*gums|sensitivity|swelling|daant\s*me\s*dard|daat\s*me\s*dard|daant\s*dard|daat\s*dard|dard|pain|ache)\b/i);
    if (issueMatch) {
      state.dental_issue = issueMatch[0];
      console.log(`🦷 [Issue Extracted] Extracted dental issue: "${state.dental_issue}"`);
    }
  }

  // 3. Date extraction (allow user to change/override date anytime before booking, including combined inputs like "20 november 12:30 pm")
  const dateCandidate = messageText.match(/\b(today|tomorrow|tomorow|tommorrow|tomrw|tmrw|tmr|aaj|kal|parso|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\b\d{1,2}(?:st|nd|rd|th)\b)\b/i);

  if (dateCandidate) {
    const parsedDate = resolveAndValidateDate(dateCandidate[0]);
    if (parsedDate.valid) {
      state.date = parsedDate.date;
      state.date_error = null;
      console.log(`📅 [Date Updated/Overridden] "${state.date}"`);
    } else {
      state.date_error = parsedDate;
      console.log(`⚠️ [Date Invalid/Past]`, parsedDate);
    }
  }

  // 4. Phone number extraction FIRST (7 to 13 digits)
  const phonePattern = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|\b\d{10}\b|\b\d{7,13}\b/;
  const phoneMatch = messageText.match(phonePattern);
  if (phoneMatch && !state.patient_phone) {
    state.patient_phone = phoneMatch[0].replace(/[\s-]/g, '');
    console.log(`📞 [Phone Extracted] Extracted contact phone: "${state.patient_phone}"`);
  }

  // 5. Patient name extraction
  if (!state.patient_name) {
    const nameMatch = messageText.match(/(?:my\s+name\s+is|name\s*[:=-]|i\s*am|this\s+is|naam\s+hai|mera\s+naam)\s+([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20}){0,3})/i);
    if (nameMatch) {
      const extracted = nameMatch[1].trim();
      if (!/^(first|second|new|returning|regular|old|teeth|tooth|dr|doctor|my|i|this|mera)\b/i.test(extracted)) {
        state.patient_name = extracted;
        console.log(`👤 [Name Extracted] Extracted patient name: "${state.patient_name}"`);
      }
    }
  }

  // 6. Time slot extraction (allow user to change/override time anytime before booking)
  const isPurePhone = /^(?:\+?91[\s-]?)?\d{7,13}$/.test(messageText.trim().replace(/[\s-]/g, ''));
  if (!isPurePhone) {
    const textWithoutPhone = messageText.replace(/(?:\+?91[\s-]?)?\d{7,13}\b/g, '');
    const timeMatch = textWithoutPhone.toLowerCase().match(/\b([01]?\d|2[0-3]):([0-5]\d)(?:\s*(am|pm))?\b|\b(1[0-2]|[1-9])\s*(am|pm)\b|\b(?:at|around)\s*(1[0-2]|[1-9])(?:\s*(am|pm))?\b|\b(after\s*12|dophar|afternoon|noon|sham\s*ko\s*\d)\b/i);
    if (timeMatch) {
      const resolvedTime = normalizeSlotTime(timeMatch[0]);
      if (resolvedTime && /^\d{2}:\d{2}$/.test(resolvedTime)) {
        state.time_slot = resolvedTime;
        console.log(`⏰ [Time Updated/Overridden] "${state.time_slot}"`);
      }
    }
  }

  // 7. Visit type extraction
  if (!state.visit_type) {
    if (/\b(first[\s-]?time|1st[\s-]?time|new\s+patient|pehli\s+baar|nayi\s+baar|pehli\s+bar|first\s+visit)\b/i.test(messageText)) {
      state.visit_type = 'first_time';
      console.log(`🏷️ [Visit Type Extracted] First-time Patient`);
    } else if (/\b(returning|regular|old\s+patient|already\s+visited|pehle\s+bhi|pehle\s+aaya|pehle\s+aayi|visited\s+before)\b/i.test(messageText)) {
      state.visit_type = 'returning';
      console.log(`🏷️ [Visit Type Extracted] Returning Patient`);
    }
  }

  state.last_updated = Date.now();
}

function getContextAwareFallback(state, settings) {
  const isEn = state?.language === 'en';
  const issue = state?.dental_issue || '';
  const date = state?.date;
  const time = state?.time_slot;
  const name = state?.patient_name;
  const phone = state?.patient_phone;
  const visitType = state?.visit_type;

  // Case 0: Already booked - Answer follow-ups directly without slot suggestions
  if (state?.is_booked) {
    if (isEn) {
      return `Your appointment is already confirmed for ${state.date || 'your scheduled date'} at ${formatSlotDisplay(state.time_slot)} (Booking ID: ${state.booking_id || 'Confirmed'}). Please let us know if you have any questions about fees, clinic directions, or instructions! 😊`;
    } else {
      return `Aapki appointment ${state.date || 'scheduled date'} ko ${formatSlotDisplay(state.time_slot)} baje confirm hai (Booking ID: ${state.booking_id || 'Confirmed'}). Agar fees, address ya koi bhi sawal ho toh zaroor batayein! 😊`;
    }
  }

  // Case 0.5: Date error (invalid day in month or past date)
  if (state?.date_error) {
    if (state.date_error.error === 'invalid_day_in_month') {
      return isEn ? state.date_error.message_en : state.date_error.message_hi;
    }
    if (state.date_error.error === 'past_date') {
      return isEn ? state.date_error.message_en : state.date_error.message_hi;
    }
  }

  // Case 1: Issue, Date, Time, Name, Phone are all known, but visit_type is missing
  if (name && phone && !visitType) {
    if (isEn) {
      return `One last thing—is this your first visit to Dr. Sharma's clinic, or have you visited us before? 😊`;
    } else {
      return `Ek aakhri sawal—kya aap Dr. Sharma ke clinic pehli baar aa rahe hain ya pehle bhi visit kar chuke hain? 😊`;
    }
  }

  // Case 2: Date and Time known, but Name or Phone missing
  if (time && (!name || !phone)) {
    if (isEn) {
      return `Could you please share your full name and contact phone number? 👤📞`;
    } else {
      return `Please apna poora naam aur contact phone number share kar dijiye 👤📞`;
    }
  }

  // Case 3: Date known, but Time missing
  if (date && !time) {
    if (isEn) {
      return `We have 10:00 AM, 11:30 AM, 2:00 PM, and 4:30 PM available ⏰ Which time works best for you?`;
    } else {
      return `Hamare paas 10:00 AM, 11:30 AM, 2:00 PM aur 4:30 PM ke slots available hain ⏰ Aapko kaunsa time convenient rahega?`;
    }
  }

  // Case 4: Dental issue known, but Date missing (Natural situation-aware initial response)
  if (issue && !date) {
    const isPain = /\b(pain|dard|ache|cavity|bleed|hurt|swelling|broken|sensitive|sensitivity|emergency|daat|daant)\b/i.test(issue);
    if (isEn) {
      if (isPain) {
        return `I'm sorry to hear you're dealing with ${issue}! We'll get Dr. Sharma to check that right away. Which day works best for you to come in — today, tomorrow, or an upcoming date? 📅`;
      } else {
        return `Got it, we can definitely get you scheduled for ${issue}! 👍 Which day would you prefer to visit — today, tomorrow, or a specific date? 📅`;
      }
    } else {
      if (isPain) {
        return `Oh, daant mein dard sun kar bura laga! Hum jaldi hi Dr. Sharma se checkup kara denge. Aap kis din aana prefer karenge — aaj, kal ya koi specific date? 📅`;
      } else {
        return `Bilkul, ${issue} ke liye appointment schedule kar dete hain! 👍 Aap kis din visit karna chahenge — aaj, kal ya koi specific date? 📅`;
      }
    }
  }

  // Case 5: Basic initial consultation question
  if (isEn) {
    return `Hello! How can I help you with your dental care today? Please let me know what treatment or consultation you need 👍`;
  } else {
    return `Main aapki appointment book karne mein madad kar sakta hoon. Aapko kis problem ke liye consult karna hai? 😊`;
  }
}

// ─── Direct Gemini REST API Caller ──────────────────────────────────────────
async function callGeminiRestApi({ model, systemPrompt, contents, tools, apiKey, timeoutMs = 10000 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    contents,
    generationConfig: {
      maxOutputTokens: 300,
      temperature: 0.3,
    },
  };
  if (systemPrompt) {
    payload.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: timeoutMs,
  });

  return response.data;
}

// ─── Gemini AI Processing ─────────────────────────────────────────────────────
async function processWithGemini(conversationId, phone, messageText, messageType, imageUrl, t0 = Date.now()) {
  const startTime = Date.now();
  try {
    const settings = await getClinicSettings();
    const dateCtx = getRealtimeDateContext();

    // Retrieve or initialize in-memory booking state for this conversation
    let state = conversationStateMap.get(conversationId);
    if (!state) {
      state = {
        patient_name: null,
        patient_phone: null,
        visit_type: null,
        dental_issue: null,
        date: null,
        time_slot: null,
        language: null,
        is_booked: false,
        booking_id: null,
        last_updated: Date.now(),
      };
      conversationStateMap.set(conversationId, state);
    }

    // Check Supabase if this user already has an active confirmed booking
    if (!state.is_booked && phone) {
      try {
        const { data: existingAppt } = await supabase
          .from('appointments')
          .select('booking_id, patient_name, patient_phone, dental_issue, appointment_date, time_slot')
          .eq('patient_phone', phone)
          .neq('status', 'Cancelled')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingAppt && existingAppt.booking_id) {
          state.is_booked = true;
          state.booking_id = existingAppt.booking_id;
          state.patient_name = state.patient_name || existingAppt.patient_name;
          state.patient_phone = state.patient_phone || existingAppt.patient_phone;
          state.dental_issue = state.dental_issue || existingAppt.dental_issue;
          state.date = state.date || existingAppt.appointment_date;
          state.time_slot = state.time_slot || existingAppt.time_slot;
          console.log(`📌 [Existing Booking Recovered] Booking ID: ${state.booking_id} for ${state.date} at ${state.time_slot}`);
        }
      } catch (dbErr) {
        // Continue with memory state
      }
    }

    // Fast path: Strict English-only greeting (sub-millisecond, no Gemini call)
    if (messageType === 'text' && isBasicGreeting(messageText)) {
      const fastGreeting = "Hello! Welcome to Dr. Sharma's Dental Clinic 👋 How can I help you today?";
      const tDispatch = Date.now();
      try {
        await sendWhatsAppMessage(phone, fastGreeting);
        console.log(`⚡ [Fast-Path Greeting] Dispatched in ${Date.now() - tDispatch}ms to ${phone}`);
      } catch (metaErr) {
        console.warn('[processWithGemini Fast Greeting Error]:', metaErr.message);
      }
      return fastGreeting;
    }

    // Extract details and strictly lock language and fields before Gemini is called
    updateStateFromMessage(state, messageText);

    // Fast path: Simple closing acknowledgment when appointment is already confirmed
    if (state.is_booked && isSimpleAcknowledgment(messageText)) {
      const isHinglish = state.language === 'hinglish' || BROAD_HINGLISH_REGEX.test(messageText);
      const ackReply = isHinglish
        ? "Bilkul! Aapke scheduled time par milte hain 😊"
        : "You're welcome! See you at your scheduled appointment 😊";

      console.log(`⚡ [POST-BOOKING ACKNOWLEDGMENT] Dispatched in ${Date.now() - t0}ms to ${phone}`);
      const tDispatch = Date.now();
      try {
        await sendWhatsAppMessage(phone, ackReply);
        console.log(`⚡ [Ack Dispatch API] Dispatched in ${Date.now() - tDispatch}ms`);
      } catch (metaErr) {
        console.warn('[processWithGemini Ack Error]:', metaErr.message);
      }

      // Background tracking to DB and Socket
      (async () => {
        try {
          await supabase.from('chat_messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: ackReply,
            message_type: 'text',
            created_at: new Date().toISOString(),
          });
          io.to(conversationId).emit('new_message', {
            conversation_id: conversationId,
            role: 'assistant',
            content: ackReply,
            message_type: 'text',
            created_at: new Date().toISOString(),
          });
        } catch (dbErr) {
          console.warn('[Ack DB Tracking Error]:', dbErr.message);
        }
      })().catch(console.warn);

      return ackReply;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Build system prompt enforcing:
    // 1. Natural Language Detection (English vs Hinglish) matching patient naturally on every turn
    // 2. Natural Situation-Aware Initial Acknowledgement (empathy for pain vs cheerful confirmation for routine care)
    // 3. Zero Echo / Repetition on subsequent turns
    // 4. Invalid Calendar Date Guard & Past Date Rejection (no backward rolling)
    // 5. Allow Date/Time Overrides anytime before confirmed booking
    // 6. Post-Booking Re-Check Prevention & Concise Follow-Up Handling
    // 7. Sequential Booking Flow & Standalone Final Visit-Type Question
    const systemPrompt = `You are Dr. Sharma's friendly, smart, and empathetic AI receptionist for ${settings.clinic_name}.
Clinic Address: ${settings.address || 'Suite 402, Dental Care Plaza, Metro Station Road'}.
Doctor: ${settings.doctor_name || 'Dr. Sharma'}.
Working Hours: ${settings.timings_start || '09:00'} - ${settings.timings_end || '18:00'}
Lunch Break: ${settings.lunch_start || '13:00'} - ${settings.lunch_end || '14:00'} (Clinic closed for lunch)
Weekly Closure: ${settings.weekly_off || 'Sunday'} (Strictly closed on ${settings.weekly_off || 'Sunday'}s)
Consultation Fee: ₹${settings.consultation_fee || 500}.
Services: ${settings.services || 'General Dentistry, Scaling, Root Canal Treatment (RCT), Braces, Implants, Tooth Extraction, Teeth Whitening'}.

CURRENT REAL-TIME CALENDAR CONTEXT:
- Today is: ${dateCtx.todayFormatted} (Exact Date: ${dateCtx.todayStr})
- Current Time: ${dateCtx.currentTime}
- Tomorrow is: ${dateCtx.tomorrowFormatted} (Exact Date: ${dateCtx.tomorrowStr})
- Current Month & Year: ${dateCtx.monthName} ${dateCtx.year}

CURRENT BOOKING & PATIENT STATUS:
- Detected Language: ${state.language === 'hinglish' ? 'Hinglish (Hindi in Roman script)' : 'English'}
- Booking Completed: ${state.is_booked ? `YES (Booking ID: ${state.booking_id || 'Confirmed'}, Date: ${state.date}, Time: ${state.time_slot})` : 'NO'}
- Dental Issue: ${state.dental_issue || 'NOT YET PROVIDED'}
- Preferred Date: ${state.date || 'NOT YET PROVIDED'}
- Selected Slot: ${state.time_slot || 'NOT YET PROVIDED'}
- Patient Name: ${state.patient_name || 'NOT YET PROVIDED'}
- Contact Phone: ${state.patient_phone || 'NOT YET PROVIDED'}
- Visit Type: ${state.visit_type ? (state.visit_type === 'returning' ? 'Returning Patient' : 'First-time Patient') : 'NOT YET PROVIDED'}

🚨 CRITICAL RULE 1: NATURAL LANGUAGE DETECTION (ENGLISH vs. HINGLISH)
- Detect the language of the patient's message naturally:
  * If the patient writes in Hinglish (Hindi written in English/Roman script, even with casual SMS spellings like 'mujhe', 'meko', 'mereko', 'daat', 'daant', 'bohot', 'bahut', 'krna', 'karna', 'h', 'hai', 'kal', 'aaj', 'parso'), reply in natural, polite Hinglish.
  * If the patient writes in English, reply in English.
  * Match the patient's language on every turn unless they switch.

🚨 CRITICAL RULE 2: NATURAL SITUATION-AWARE INITIAL ACKNOWLEDGEMENT (INITIAL ISSUE TURN ONLY)
- When the patient FIRST states their dental issue or reason for visiting:
  * DO NOT jump robotically to the date question with a cold, repetitive template!
  * Respond with a short, warm, situation-appropriate human reaction (1 brief sentence tailored to their specific situation), followed by asking for their preferred date (or date & time):
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

🚨 CRITICAL RULE 3: ZERO ECHO / REPETITION ON SUBSEQUENT TURNS
- For all SUBSEQUENT turns after the initial issue turn:
  * NEVER repeat, echo, or re-confirm previous answers!
  * BAD: "Okay, 17th November is noted. What time would you prefer?"
  * GOOD: "We have slots open at 10:00 AM, 11:30 AM, 2:00 PM, and 4:30 PM. Which time works best for you? ⏰"
  * BAD: "Great! 11:00 AM is locked. Could you please share your name and phone?"
  * GOOD: "Could you please share your full name and contact phone number? 👤📞"
- Move directly to the single next question. The full booking summary is strictly reserved for the final confirmation card.

🚨 CRITICAL RULE 4: INVALID CALENDAR DATE GUARD & NO PAST DATES
- Today is ${dateCtx.todayFormatted} (${dateCtx.todayStr}). Current month is ${dateCtx.monthName} ${dateCtx.year}.
- NEVER roll an invalid day like "31st" in a 30-day month (November only has 30 days) backward to a past month (like October 31).
- If check_availability returns is_invalid_date: true (e.g. November only has 30 days) or is_past_date: true (date has already passed):
  * Politely inform the patient in their language (English or Hinglish) using the explanation provided in the tool result that the date is invalid or has already passed, and ask for a valid upcoming date:
    - English Example: "November only has 30 days, so the 31st is not a valid date. Could you please choose a valid upcoming date? 📅"
    - Hinglish Example: "November mein sirf 30 din hote hain, isliye 31st valid date nahi hai. Kripya koi valid aane wali date batayein? 📅"

🚨 CRITICAL RULE 5: ALLOW DATE & TIME OVERRIDE ANYTIME BEFORE BOOKING
- Before the appointment is confirmed (state.is_booked === false), the patient can change or override their preferred date and time anytime (including combined messages like "20 november 12:30 pm"). Always respect their latest date/time choice!

🚨 CRITICAL RULE 6: POST-BOOKING RE-CHECK PREVENTION & CONCISE FOLLOW-UP HANDLING
- If the appointment is already booked (Booking Completed: YES, Booking ID: ${state.booking_id || 'Confirmed'}):
  * The appointment is ALREADY 100% BOOKED AND CONFIRMED.
  * NEVER call check_availability, NEVER suggest alternative slots, and NEVER ask for date/time again unless the patient explicitly asks to "reschedule", "change time", "change date", or "book another appointment".
  * If the patient asks any follow-up questions (fees, clinic address, timings, prep/instructions, directions, what to bring, or says thanks/see you):
    Answer directly, concisely, and warmly in their language WITHOUT ANY slot suggestions or booking prompts:
    - Consultation Fee: ₹${settings.consultation_fee || 500} (payable at the clinic via UPI, cash, or card).
    - Clinic Address: ${settings.address || 'Suite 402, Dental Care Plaza, Metro Station Road'}.
    - Working Hours: ${settings.timings_start || '09:00'} - ${settings.timings_end || '18:00'} (closed on ${settings.weekly_off || 'Sunday'}s).
    - Preparation / Instructions: Please arrive 10 minutes prior to your slot. Bring previous dental records or X-rays if available.
    - Gratitude / Closing: Reiterate warmly that Dr. Sharma and the team look forward to seeing them on ${state.date} at ${formatSlotDisplay(state.time_slot)}.

🚨 CRITICAL RULE 7: STRICT SEQUENTIAL BOOKING FLOW (1 QUESTION AT A TIME)
Step 1 - Dental Issue: If unknown, ask what dental issue or treatment they need consultation for. (DO NOT echo greeting back).
Step 2 - Date: Once issue is known, give the 1-sentence situation-aware reaction (Rule 2) and ask for their preferred date.
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
- Once Date and Time Slot are locked, NEVER call check_availability again unless the patient explicitly asks to reschedule or change timing.

🚨 CRITICAL RULE 6: SMART HUMAN TYPO & CASUAL INPUT UNDERSTANDING
- Real patients make spelling mistakes, shorthand, and casual slang on WhatsApp:
  * Dates: "tomorow", "tommorrow", "tomrw", "tmrw", "2day", "kal", "parso", "17th nov", "next monday"
  * Dental issues: "clening", "rct", "cavty", "tootheche", "chekup", "braces", "daant me dard", "akal daadh"
  * Shorthand times: "2pm", "4:30", "morning 10", "evening 5", "after 12 am" (which means afternoon 12 PM / post lunch!), "noon", "sham ko 5"
  * Confirmations: "yesss", "ha", "haan", "sure", "ok", "done", "plz book"
  * Visit types: "first time", "pehli baar", "new patient", "1st time", "regular", "already a patient", "pehle bhi aaya tha"
- ALWAYS interpret their intent smartly and move the conversation forward! NEVER get confused, NEVER repeat a question the patient already answered, and NEVER ask the user what format they mean.

🚨 CRITICAL RULE 7: STRICT LANGUAGE CONSISTENCY & CLEAN EMOJIS
- Maintain the patient's language (${state.language === 'hinglish' ? 'Hinglish' : 'English'}) consistently through EVERY turn including the final confirmation card!
- Clean emojis (👋, 📅, ⏰, 😊, 👍, 🦷, 🎉) should be used appropriately. Keep messages short and punchy for WhatsApp.

🚨 CRITICAL RULE 8: PROGRAMMATIC WEEKDAY ACCURACY (NO LLM GUESSING)
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
  📍 Clinic: ${settings.address || 'Suite 402, Dental Care Plaza'}

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
  📍 Clinic: ${settings.address || 'Suite 402, Dental Care Plaza'}

  Dr. Sharma aapka wait karenge. Please appointment time se 10 minute pehle clinic pahunch jaiyega. Agar timing change karni ho ya koi query ho, toh zaroor batayein! 😊"

DYNAMIC DATE RESOLUTION:
- Automatically resolve "today", "tomorrow", "kal", "parso", "15th Nov", "20 November" into YYYY-MM-DD format based on Today (${dateCtx.todayStr}).
- NEVER ask the patient what year it is or ask for "YYYY-MM-DD".
- If checking today (${dateCtx.todayStr}), notice that clinic is closed on ${settings.weekly_off || 'Sunday'}s. If today is Sunday, explain warmly that clinic is closed on Sundays and offer slots for tomorrow (Monday)!`;

    // Fetch previous messages for conversation history (last 10 messages gives full context)
    const { data: historyRows } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .range(1, 10);

    const history = (historyRows || [])
      .reverse()
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    // Google Generative AI requires history to start with a 'user' turn
    while (history.length > 0 && history[0].role === 'model') {
      history.shift();
    }

    // Define Gemini tools (function declarations)
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'check_availability',
            description: `Check available 30-minute appointment slots for a given date at the clinic. NEVER call this tool with a phone number or when the user is providing their contact information. Only call this when selecting or changing an appointment date. Always provide date in YYYY-MM-DD based on Today (${dateCtx.todayStr}).`,
            parameters: {
              type: 'OBJECT',
              properties: {
                date: {
                  type: 'STRING',
                  description: `Date to check in YYYY-MM-DD format (e.g. ${dateCtx.tomorrowStr})`,
                },
              },
              required: ['date'],
            },
          },
          {
            name: 'book_appointment',
            description: 'Book a confirmed dental appointment in Google Calendar, Google Sheets, and clinic database after verifying slot availability and collecting patient details.',
            parameters: {
              type: 'OBJECT',
              properties: {
                patient_name: { type: 'STRING', description: 'Full name of the patient' },
                patient_phone: { type: 'STRING', description: 'Contact phone number provided by the patient for appointment reminders and confirmation' },
                visit_type: { 
                  type: 'STRING', 
                  enum: ['first_time', 'returning'], 
                  description: 'Whether the patient is visiting for the first time (first_time) or is a regular/returning patient (returning)' 
                },
                dental_issue: { type: 'STRING', description: 'Dental issue or treatment requested' },
                date: { type: 'STRING', description: 'Appointment date in YYYY-MM-DD format' },
                time_slot: { type: 'STRING', description: 'Appointment time slot in HH:MM format (e.g. 10:30, 15:00)' },
              },
              required: ['patient_name', 'patient_phone', 'visit_type', 'dental_issue', 'date', 'time_slot'],
            },
          },
          {
            name: 'reschedule_appointment',
            description: `Reschedule an existing confirmed appointment to a new date and time slot. Call this whenever the patient wants to change or reschedule their appointment. Always provide date in YYYY-MM-DD based on Today (${dateCtx.todayStr}).`,
            parameters: {
              type: 'OBJECT',
              properties: {
                new_date: {
                  type: 'STRING',
                  description: `New appointment date in YYYY-MM-DD format (e.g. ${dateCtx.tomorrowStr})`,
                },
                new_time_slot: {
                  type: 'STRING',
                  description: 'New appointment time slot in HH:MM format (e.g. 11:30, 15:00)',
                },
                booking_id: {
                  type: 'STRING',
                  description: 'Existing booking ID if known (e.g. BK-XXXXXX)',
                },
              },
              required: ['new_date', 'new_time_slot'],
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

    // Build user message parts
    const userParts = [];
    if (messageType === 'image' && imageUrl) {
      try {
        const metaToken = await getMetaAccessToken();
        const imgResponse = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          headers: { Authorization: `Bearer ${metaToken}` },
        });
        const base64 = Buffer.from(imgResponse.data).toString('base64');
        const mimeType = imgResponse.headers['content-type'] || 'image/jpeg';
        userParts.push({ inlineData: { data: base64, mimeType } });
      } catch (imgErr) {
        console.warn('[processWithGemini] Image fetch warning:', imgErr.message);
      }
    }
    userParts.push({ text: messageText || '[Patient sent an image]' });

    // Multi-model fallback strategy using direct REST API:
    // 1. GEMINI_MODEL (settings, .env, or default gemini-3.5-flash-lite)
    // 2. gemini-3.5-flash-lite (sub-1s latency, active quota)
    // 3. gemini-flash-lite-latest
    // 4. gemini-3.5-flash
    // 5. gemini-2.5-flash
    const candidateModels = [
      settings.gemini_model || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.5-flash',
      'gemini-2.5-flash',
    ];
    const uniqueCandidateModels = [...new Set(candidateModels)];

    // Initial conversation contents
    const conversationContents = [
      ...history,
      { role: 'user', parts: userParts },
    ];

    let geminiData = null;
    let activeModelName = '';

    for (const mName of uniqueCandidateModels) {
      const tModelStart = Date.now();
      try {
        geminiData = await callGeminiRestApi({
          model: mName,
          systemPrompt,
          contents: conversationContents,
          tools,
          apiKey: settings.gemini_api_key || process.env.GEMINI_API_KEY,
          timeoutMs: 10000,
        });
        activeModelName = mName;
        console.log(`⚡ [Gemini Success] Model ${mName} responded in ${Date.now() - tModelStart}ms (Overall: ${Date.now() - t0}ms)`);
        break;
      } catch (modelErr) {
        const errDetail = modelErr.response?.data?.error?.message || modelErr.message;
        console.warn(`⚠️ [Gemini Fallback] Model ${mName} failed in ${Date.now() - tModelStart}ms (${errDetail?.slice(0, 80)}). Trying next model...`);
      }
    }

    if (!geminiData) {
      throw new Error('All Gemini model candidates failed to respond within timeout.');
    }

    let finalText = '';

    // Tool calling execution loop (up to 3 turns)
    for (let iterations = 0; iterations < 3; iterations++) {
      const candidate = geminiData.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts || [];
      const functionCallPart = parts.find((p) => p.functionCall);

      if (!functionCallPart) {
        finalText = parts.filter(p => !p.thought).map((p) => p.text || '').join('').trim();
        break;
      }

      const { name: fnName, args: rawArgs } = functionCallPart.functionCall;
      let fnArgs = rawArgs || {};
      if (typeof fnArgs === 'string') {
        try { fnArgs = JSON.parse(fnArgs); } catch {}
      }
      console.log(`[Gemini] Function call: ${fnName}`, fnArgs);

      // Execute the tool safely
      let fnResult;
      try {
        if (fnName === 'check_availability') {
          const hasRescheduleRequest = /\b(change|reschedule|different|dusra|dusri|badal|another|naya)\b/i.test(messageText);
          if (state.is_booked && !hasRescheduleRequest) {
            console.log(`⚡ [check_availability BLOCKED] Appointment ${state.booking_id} is already booked.`);
            fnResult = {
              status: 'already_booked',
              booking_id: state.booking_id,
              date: state.date,
              time_slot: state.time_slot,
              message: `Appointment is ALREADY confirmed and booked with Booking ID ${state.booking_id} for ${state.date} at ${state.time_slot}. DO NOT suggest slots or re-check availability. Answer the patient's question directly.`,
            };
          } else {
            const rawDate = fnArgs.date || fnArgs.appointment_date || state.date || 'tomorrow';
            const targetDate = /^\d{7,13}$/.test(String(rawDate).trim()) ? state.date || 'tomorrow' : rawDate;
            fnResult = await withTimeout(checkAvailability(targetDate, settings), 6500, 'Availability check timed out');
            if (fnResult?.date && !fnResult.is_off_day && !fnResult.is_invalid_date && !fnResult.is_past_date) {
              state.date = fnResult.date;
              state.date_error = null;
            } else if (fnResult?.is_invalid_date || fnResult?.is_past_date) {
              state.date = null;
              state.date_error = fnResult;
            }
          }
        } else if (fnName === 'book_appointment') {
          const hasChangeRequest = /\b(change|reschedule|different|dusra|badal|another)\b/i.test(messageText);
          if (state.is_booked && state.booking_id && !hasChangeRequest) {
            console.log(`⚡ [book_appointment BLOCKED] Already booked as ${state.booking_id}`);
            fnResult = {
              success: true,
              booking_id: state.booking_id,
              message: `Appointment was ALREADY booked previously with Booking ID ${state.booking_id}.`,
            };
          } else {
            const bookingParams = {
              conversationId,
              patient_name: fnArgs.patient_name || state.patient_name || 'Valued Patient',
              patient_phone: fnArgs.patient_phone || state.patient_phone || phone,
              visit_type: fnArgs.visit_type || state.visit_type || 'first_time',
              dental_issue: fnArgs.dental_issue || state.dental_issue || 'Dental Consultation',
              date: fnArgs.date || state.date,
              time_slot: fnArgs.time_slot || state.time_slot,
              senderPhone: phone,
            };
            fnResult = await bookAppointmentAction(bookingParams, settings);
            if (fnResult.success) {
              state.is_booked = true;
              state.booking_id = fnResult.booking_id;
              state.patient_name = bookingParams.patient_name;
              state.patient_phone = bookingParams.patient_phone;
              state.visit_type = bookingParams.visit_type;
              state.dental_issue = bookingParams.dental_issue;
              state.date = bookingParams.date;
              state.time_slot = bookingParams.time_slot;
              state.last_updated = Date.now();
              conversationStateMap.set(conversationId, state);
              console.log(`🎉 [Appointment Booked & State Locked] Booking ID: ${state.booking_id}`);
            }
          }
        } else if (fnName === 'reschedule_appointment') {
          const newRawDate = fnArgs.new_date || fnArgs.date || state.date;
          const newDate = normalizeDate(newRawDate);
          const newTimeSlot = fnArgs.new_time_slot || fnArgs.time_slot || state.time_slot;
          const targetBookingId = fnArgs.booking_id || state.booking_id;

          const avail = await withTimeout(checkAvailability(newDate, settings), 6500, 'Availability check timed out');
          const openSlots = avail.available_slots || [];

          if (avail.is_off_day) {
            fnResult = {
              success: false,
              message: avail.reason || `The clinic is closed on ${newDate}.`,
            };
          } else if (!openSlots.includes(newTimeSlot)) {
            fnResult = {
              success: false,
              message: `Slot ${newTimeSlot} on ${newDate} is not available. Available slots: ${openSlots.slice(0, 6).join(', ')}`,
            };
          } else {
            // Programmatic exact weekday calculation
            const dayOfWeek = getExactWeekday(newDate);

            // Invalidate calendar cache for both old and new dates
            if (state.date) invalidateCalendarCache(state.date);
            invalidateCalendarCache(newDate);

            // Update in-memory state immediately
            state.date = newDate;
            state.time_slot = newTimeSlot;
            state.is_booked = true;
            state.last_updated = Date.now();
            conversationStateMap.set(conversationId, state);

            // Sync to Supabase appointments table
            (async () => {
              try {
                if (targetBookingId) {
                  await supabase
                    .from('appointments')
                    .update({
                      appointment_date: newDate,
                      time_slot: newTimeSlot,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('booking_id', targetBookingId);
                } else {
                  await supabase
                    .from('appointments')
                    .update({
                      appointment_date: newDate,
                      time_slot: newTimeSlot,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('conversation_id', conversationId);
                }
                console.log(`🔄 [State & Supabase Synced on Reschedule] Booking: ${targetBookingId || 'N/A'}, Date: ${newDate} (${dayOfWeek}), Slot: ${newTimeSlot}`);
              } catch (dbErr) {
                console.warn('[reschedule_appointment Supabase sync warning]:', dbErr.message);
              }
            })().catch(console.warn);

            fnResult = {
              success: true,
              booking_id: targetBookingId || state.booking_id,
              date: newDate,
              day_of_week: dayOfWeek,
              time_slot: newTimeSlot,
              message: `Appointment successfully rescheduled! Booking ID: ${targetBookingId || state.booking_id}. New Date: ${newDate} (${dayOfWeek}), New Time: ${newTimeSlot}. IMPORTANT: In your confirmation message, you MUST state the date and day as "${newDate}, ${dayOfWeek}".`,
            };
          }
        } else if (fnName === 'get_clinic_info') {
          switch (fnArgs.query_type) {
            case 'services':
              fnResult = { info: settings.services || 'General Dentistry, Scaling, Root Canal, Braces, Implants.' };
              break;
            case 'prices':
              fnResult = { info: `Consultation fee: ₹${settings.consultation_fee || 500}. Other treatments priced on doctor examination.` };
              break;
            case 'timings':
              fnResult = {
                info: `Working hours: ${settings.timings_start} to ${settings.timings_end}. Lunch: ${settings.lunch_start} to ${settings.lunch_end}. Weekly closure: ${settings.weekly_off}.`,
              };
              break;
            case 'faq':
              fnResult = { info: settings.faq || 'Please reach out to our clinic for any special medical queries.' };
              break;
            default:
              fnResult = { info: 'General clinic information provided.' };
          }
        } else {
          fnResult = { error: `Unknown function: ${fnName}` };
        }
      } catch (toolErr) {
        console.error(`[Gemini] Tool error (${fnName}):`, toolErr.message);
        fnResult = { error: toolErr.message };
      }

      // Append model's candidate content (preserving functionCall and thoughtSignature)
      conversationContents.push(candidate.content);

      // Append function result with role: 'user'
      conversationContents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: fnName,
              response: typeof fnResult === 'object' && fnResult !== null ? fnResult : { result: fnResult },
            },
          },
        ],
      });

      // Send function result back to Gemini safely with model fallback
      let nextData = null;
      const turnModels = [activeModelName, ...uniqueCandidateModels.filter(m => m !== activeModelName)];
      for (const tModel of turnModels) {
        try {
          nextData = await callGeminiRestApi({
            model: tModel,
            systemPrompt,
            contents: conversationContents,
            tools,
            apiKey: settings.gemini_api_key || process.env.GEMINI_API_KEY,
            timeoutMs: 10000,
          });
          geminiData = nextData;
          activeModelName = tModel;
          break;
        } catch (turnErr) {
          console.warn(`[Gemini] Tool turn failed with ${tModel}: ${turnErr.response?.data?.error?.message?.slice(0, 80) || turnErr.message}`);
        }
      }

      if (!nextData) {
        console.warn('[Gemini] All model candidates failed on tool return turn.');
        break;
      }
    }

    if (!finalText) {
      const cand = geminiData?.candidates?.[0];
      finalText = cand?.content?.parts?.filter(p => !p.thought).map((p) => p.text || '').join('').trim() || getContextAwareFallback(state, settings);
    }

    // ── 1. Dispatch WhatsApp Message to Patient IMMEDIATELY (Priority 1) ──
    const tDispatch = Date.now();
    try {
      await sendWhatsAppMessage(phone, finalText);
      console.log(`⚡ [LATENCY LOG] End-to-End: ${Date.now() - t0}ms | Model: ${activeModelName || 'fast-fallback'} | WhatsApp Dispatch API: ${Date.now() - tDispatch}ms | Recipient: ${phone}`);
    } catch (metaErr) {
      console.error('[processWithGemini] Meta WhatsApp dispatch failed:', metaErr?.response?.data || metaErr.message);
    }

    // ── 2. Save to Supabase and emit socket event asynchronously in background ──
    (async () => {
      try {
        await supabase.from('chat_messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: finalText,
          message_type: 'text',
          created_at: new Date().toISOString(),
        });
      } catch (dbSaveErr) {
        console.warn('[processWithGemini Background] Failed to save assistant message:', dbSaveErr.message);
      }

      try {
        io.to(conversationId).emit('new_message', {
          conversation_id: conversationId,
          role: 'assistant',
          content: finalText,
          message_type: 'text',
          created_at: new Date().toISOString(),
        });
      } catch {}
    })().catch(console.warn);

    return finalText;
  } catch (err) {
    console.error('💥 [processWithGemini] Error / Timeout:', err.message);
    const settings = await getClinicSettings().catch(() => ({}));
    const state = conversationStateMap.get(conversationId) || {};
    const fallbackMessage = getContextAwareFallback(state, settings);

    try {
      await sendWhatsAppMessage(phone, fallbackMessage);
      console.log(`⚡ [Fallback Dispatched] Context-aware fallback sent in ${state.language || 'en'}: "${fallbackMessage}"`);
    } catch (fallbackErr) {
      console.error('[Fallback Send Error]:', fallbackErr.message);
    }
    return fallbackMessage;
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
  const status = {
    meta: false,
    calendar: false,
    sheets: false,
    calendar_id: '',
    service_account_email: process.env.GOOGLE_CLIENT_EMAIL || '',
  };

  // Test Meta API
  try {
    const phoneId = await getMetaPhoneNumberId();
    const token = await getMetaAccessToken();
    if (phoneId && token) {
      await axios.get(
        `${META_GRAPH_URL}/${phoneId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      status.meta = true;
    }
  } catch {}

  // Test Google Calendar
  try {
    const settings = await getClinicSettings();
    const calendar = getCalendarClient(settings?.google_service_account_json);
    const calId = settings.google_calendar_id || process.env.GOOGLE_CALENDAR_ID || '';
    status.calendar_id = calId;
    const hasValidCalendar =
      calId &&
      !calId.includes('your_clinic_calendar_id') &&
      !calId.includes('your_') &&
      !calId.includes('placeholder');

    if (hasValidCalendar) {
      await calendar.calendars.get({ calendarId: calId });
      status.calendar = true;
    }
  } catch (calErr) {
    status.calendar_error = calErr.message;
  }

  // Test Google Sheets
  try {
    const settings = await getClinicSettings();
    const sheets = getSheetsClient(settings?.google_service_account_json);
    const sheetId = settings.google_sheet_id || process.env.GOOGLE_SHEET_ID;
    if (sheetId) {
      await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      status.sheets = true;
    }
  } catch {}

  return status;
}

// ─── Webhook: GET /webhook & /api/webhook (Verification) ─────────────────────
app.get(['/webhook', '/api/webhook'], async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`[Webhook GET] Received verification request: mode=${mode}, token=${token}, challenge=${challenge}`);

  const settings = await getClinicSettings();
  const expectedVerifyToken = settings.meta_verify_token || process.env.META_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expectedVerifyToken) {
    console.log('[Webhook GET] Verification successful — returning challenge:', challenge);
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(challenge);
  }
  console.warn(`[Webhook GET] Verification failed: mode=${mode}, token=${token}, expected=${expectedVerifyToken}`);
  return res.sendStatus(403);
});

// ─── Webhook: POST /webhook & /api/webhook (Incoming Messages) ────────────────
app.post(['/webhook', '/api/webhook'], async (req, res) => {
  const t0 = Date.now();
  // Always respond 200 immediately (WhatsApp requires fast response within 3s)
  res.sendStatus(200);

  try {
    const body = req.body;
    console.log('\n📥 [Webhook POST] Received webhook event:');
    console.log(JSON.stringify(body, null, 2));

    if (body.object !== 'whatsapp_business_account') {
      console.log(`ℹ️ [Webhook] Ignored non-WhatsApp object: ${body.object}`);
      return;
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const field = changes?.field;

    // Guardrail: Only process 'messages' changes (ignore template status, name updates, etc.)
    if (field && field !== 'messages') {
      console.log(`ℹ️ [Webhook] Ignored non-messages field: ${field}`);
      return;
    }

    const value = changes?.value;
    if (!value) {
      console.log('ℹ️ [Webhook] No entry.changes[0].value found in payload');
      return;
    }

    // Guardrail: Strictly ignore status updates (sent, delivered, read) — NEVER reply to statuses!
    if (value.statuses && value.statuses.length > 0) {
      const st = value.statuses[0];
      console.log(`ℹ️ [Webhook Status Ignored] Message ${st.id} -> ${st.status} (recipient: ${st.recipient_id})`);
      return;
    }

    // Guardrail: Must contain at least one user message
    if (!value.messages || value.messages.length === 0) {
      console.log('ℹ️ [Webhook] No messages array in payload');
      return;
    }

    const rawMessage = value.messages[0];
    const message_id = rawMessage.id;
    const rawFrom = rawMessage.from; // sender's phone number e.g. "919876543210"
    const from = normalizePhoneNumber(rawFrom);
    const type = rawMessage.type; // text | image | audio | interactive ...
    const contactName = value.contacts?.[0]?.profile?.name || '';

    if (!message_id || !from) {
      console.log('ℹ️ [Webhook] Missing message_id or sender phone, dropping');
      return;
    }

    console.log(`💬 [Webhook Message] From: ${contactName} (${from}) | Type: ${type} | ID: ${message_id}`);

    // ── GUARDRAIL 1: STALE MESSAGE CHECK (Max 120 seconds old) ───────────────
    // Meta sends unix timestamp in seconds. Stale retries hours later MUST be dropped!
    const rawTimestamp = parseInt(rawMessage.timestamp, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (rawTimestamp && (nowSec - rawTimestamp > 120)) {
      console.log(`⏱️ [Webhook Stale Guard] Dropped stale message ${message_id} (${nowSec - rawTimestamp}s old, max allowed is 120s)`);
      return;
    }

    // ── GUARDRAIL 2: DUAL-LAYER MESSAGE DEDUPLICATION (Memory + Supabase) ────
    // Layer 1: Instant in-memory check (0ms)
    if (isMemoryDuplicate(message_id)) {
      console.log(`⏩ [Webhook Dedup] In-memory dropped duplicate message: ${message_id}`);
      return;
    }

    // Layer 2: Persistent Supabase check (survives server restarts and dyno recycling)
    const alreadyProcessedInDb = await isMessageAlreadyInDb(message_id);
    if (alreadyProcessedInDb) {
      console.log(`⏩ [Webhook Dedup] DB dropped already-processed message: ${message_id}`);
      return;
    }

    // Immediately record in Supabase so any concurrent retries are locked out
    markMessageProcessedInDb(message_id);

    // Mark message as read on WhatsApp (fire & forget, non-blocking)
    (async () => {
      try {
        const phoneId = await getMetaPhoneNumberId();
        const token = await getMetaAccessToken();
        if (phoneId && token) {
          await axios.post(
            `${META_GRAPH_URL}/${phoneId}/messages`,
            {
              messaging_product: 'whatsapp',
              status: 'read',
              message_id,
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            }
          );
        }
      } catch {}
    })().catch(() => {});

    // ── Extract message body ───────────────────────────────────────────────
    let messageText = '';
    let imageUrl = null;

    if (type === 'text') {
      messageText = rawMessage.text?.body || '';
    } else if (type === 'interactive') {
      messageText = rawMessage.interactive?.button_reply?.title || rawMessage.interactive?.list_reply?.title || '';
    } else if (type === 'image') {
      const mediaId = rawMessage.image?.id;
      messageText = rawMessage.image?.caption || '';
      try {
        const token = await getMetaAccessToken();
        const mediaRes = await axios.get(`${META_GRAPH_URL}/${mediaId}`, {
          headers: { Authorization: `Bearer ${token}` },
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

    console.log(`📝 [Webhook Message Content]: "${messageText}"`);

    // ── FAST PATH 1: Strict English-Only Greeting (Sub-200ms, No Gemini Call) ──
    if (type === 'text' && isBasicGreeting(messageText)) {
      const fastGreeting = "Hello! Welcome to Dr. Sharma's Dental Clinic 👋 How can I help you today?";
      const tDispatch0 = Date.now();
      try {
        await sendWhatsAppMessage(from, fastGreeting);
        console.log(`⚡ [FAST PATH GREETING] Dispatched in ${Date.now() - t0}ms (WhatsApp API: ${Date.now() - tDispatch0}ms) to ${from}`);
      } catch (sendErr) {
        console.error('❌ [Fast-Path Greeting Error]:', sendErr?.response?.data || sendErr.message);
      }

      // Background tracking to DB and Socket (Non-blocking)
      (async () => {
        try {
          const conv = await getOrCreateConversation(from, contactName, fastGreeting, true);
          const convId = conv?.id;

          if (convId) {
            let state = conversationStateMap.get(convId) || conversationStateMap.get(from);
            if (!state) {
              state = {
                patient_name: contactName || null,
                patient_phone: from,
                visit_type: null,
                dental_issue: null,
                date: null,
                time_slot: null,
                language: null,
                last_updated: Date.now(),
              };
              conversationStateMap.set(convId, state);
            }

            await supabase.from('chat_messages').insert([
              {
                conversation_id: convId,
                role: 'user',
                content: messageText,
                message_type: type,
                whatsapp_message_id: message_id,
                created_at: new Date().toISOString(),
              },
              {
                conversation_id: convId,
                role: 'assistant',
                content: fastGreeting,
                message_type: 'text',
                created_at: new Date(Date.now() + 50).toISOString(),
              },
            ]);

            io.to(convId).emit('new_message', {
              conversation_id: convId,
              role: 'user',
              content: messageText,
              message_type: type,
              created_at: new Date().toISOString(),
            });
            io.to(convId).emit('new_message', {
              conversation_id: convId,
              role: 'assistant',
              content: fastGreeting,
              message_type: 'text',
              created_at: new Date().toISOString(),
            });
          }
        } catch (dbErr) {
          console.warn('[Fast Path DB Tracking Warning]:', dbErr.message);
        }
      })().catch(console.warn);

      return;
    }

    // ── 2. NON-GREETING or SUBSEQUENT MESSAGES: Contextual Gemini Flow ──
    const conv = await getOrCreateConversation(from, contactName, messageText, true);
    const conversationId = conv?.id || `temp-${from}`;

    // Save incoming user message in background
    Promise.resolve(supabase.from('chat_messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: messageText,
      message_type: type,
      media_url: imageUrl,
      whatsapp_message_id: message_id,
      created_at: new Date().toISOString(),
    })).catch(() => {});

    io.to(conversationId).emit('new_message', {
      conversation_id: conversationId,
      role: 'user',
      content: messageText,
      message_type: type,
      media_url: imageUrl,
      created_at: new Date().toISOString(),
    });

    // Check AI mode
    if (conv && conv.ai_mode === false) {
      console.log(`👤 [Webhook] Human mode active for conversation ${conversationId}. No AI response.`);
      return;
    }

    // Process with Gemini AI
    console.log(`🤖 [Webhook] Triggering Gemini for conversation ${conversationId} (elapsed: ${Date.now() - t0}ms)...`);
    await processWithGemini(conversationId, from, messageText, type, imageUrl, t0);
  } catch (err) {
    console.error('❌ [Webhook POST Error]:', err.message, err.stack);
    // Unsolicited auto-messaging removed: NEVER send automated emergency messages to users on error
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
    invalidateClinicSettingsCache();
    res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('[/api/settings]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/invalidate-cache — Immediately clear in-memory credentials cache
app.post('/api/settings/invalidate-cache', (req, res) => {
  invalidateClinicSettingsCache();
  console.log('🔄 [Settings Cache] In-memory cache invalidated via API.');
  res.json({ success: true, message: 'Settings cache invalidated.' });
});

// POST /api/sheets/setup — Create Google Sheets tabs with headers
app.post('/api/sheets/setup', async (req, res) => {
  try {
    const settings = await getClinicSettings();
    const sheetId = settings.google_sheet_id || process.env.GOOGLE_SHEET_ID;
    if (!sheetId) {
      return res.status(400).json({ error: 'Google Sheet ID not configured' });
    }

    const sheets = getSheetsClient(settings?.google_service_account_json);

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
    let rawPhone = (req.body.phone || '919876543210').trim();
    let phone = normalizePhoneNumber(rawPhone) || '919876543210';

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    let conv = null;
    if (conversationId) {
      const { data } = await supabase.from('conversations').select('*').eq('id', conversationId).maybeSingle();
      if (data) {
        conv = data;
        phone = normalizePhoneNumber(data.phone_number) || phone;
      }
    }

    if (!conv) {
      conv = await getOrCreateConversation(phone, patientName, message.trim(), true);
    } else {
      await supabase
        .from('conversations')
        .update({
          phone_number: phone,
          last_message: message.trim(),
          last_message_at: new Date().toISOString(),
          ...(patientName && (!conv.patient_name || conv.patient_name === 'Patient' || conv.patient_name === 'Rahul Sharma') ? { patient_name: patientName } : {}),
        })
        .eq('id', conv.id);
    }

    if (!conv) {
      return res.status(500).json({ error: 'Failed to find or create conversation thread' });
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

// Health check routes for Render, Vercel & Uptime Monitors
app.get(['/health', '/api/health', '/'], (req, res) => {
  res.json({
    status: 'ok',
    service: 'whatsapp-dental-ai-backend',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🦷 WhatsApp AI Dental Receptionist Server`);
  console.log(`   Server running on 0.0.0.0:${PORT}`);
  console.log(`   Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`   Webhook URL:  http://0.0.0.0:${PORT}/webhook`);
  console.log(`   Frontend:     ${FRONTEND_URL}\n`);
});

export default app;
