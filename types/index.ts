// ============================================================
// types/index.ts — Shared TypeScript types for the entire app
// ============================================================

// ------------------------------------------------------------------
// Clinic configuration (stored in Supabase + overridable via dashboard)
// ------------------------------------------------------------------
export interface ClinicSettings {
  id?: string;
  clinicName: string;
  doctorName: string;
  address: string;
  phone: string;
  /** 24-hour time string, e.g. "09:00" */
  timingsStart: string;
  /** 24-hour time string, e.g. "18:00" */
  timingsEnd: string;
  /** 24-hour time string, e.g. "13:00" */
  lunchStart: string;
  /** 24-hour time string, e.g. "14:00" */
  lunchEnd: string;
  /** Day name, e.g. "Sunday" */
  weeklyOff: string;
  /** Appointment slot duration in minutes */
  slotDurationMinutes: number;
  consultationFee: number;
  googleSheetId: string;
  googleCalendarId: string;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  metaVerifyToken?: string;
  googleServiceAccountJson?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  hasMetaAccessToken?: boolean;
  hasMetaPhoneNumberId?: boolean;
  hasMetaVerifyToken?: boolean;
  hasGoogleCalendarId?: boolean;
  hasGoogleSheetId?: boolean;
  hasGoogleServiceAccountJson?: boolean;
  hasGeminiApiKey?: boolean;
  hasMetaToken?: boolean;
  hasMetaPhoneId?: boolean;
  hasGeminiKey?: boolean;
  hasGoogleServiceAccount?: boolean;
  aiMode: AIMode;
  welcomeMessage: string;
  createdAt?: string;
  updatedAt?: string;
}

// ------------------------------------------------------------------
// Appointment
// ------------------------------------------------------------------
export interface Appointment {
  id: string;
  patientName: string;
  patientPhone: string;
  /** ISO 8601 date-time string */
  dateTime: string;
  /** Duration in minutes */
  durationMinutes: number;
  treatmentType: string;
  notes?: string;
  status: AppointmentStatus;
  googleCalendarEventId?: string;
  googleSheetRowIndex?: number;
  createdAt: string;
  updatedAt: string;
}

export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no-show';

// ------------------------------------------------------------------
// Patient
// ------------------------------------------------------------------
export interface Patient {
  id: string;
  name: string;
  /** WhatsApp phone number in E.164 format, e.g. "+919876543210" */
  phone: string;
  email?: string;
  dateOfBirth?: string;
  medicalNotes?: string;
  lastVisit?: string;
  totalVisits: number;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------
// Chat / WhatsApp messaging
// ------------------------------------------------------------------
export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** ISO 8601 */
  timestamp: string;
  status?: MessageStatus;
  /** Meta message ID returned by WhatsApp Cloud API */
  whatsappMessageId?: string;
  /** Attached media URL if any */
  mediaUrl?: string;
  mediaType?: 'image' | 'audio' | 'document' | 'video';
}

// ------------------------------------------------------------------
// Conversation thread
// ------------------------------------------------------------------
export interface ConversationThread {
  id: string;
  patientPhone: string;
  patientName?: string;
  messages: ChatMessage[];
  aiMode: AIMode;
  /** Whether the conversation is currently active (last msg < 24 h) */
  isActive: boolean;
  /** ISO 8601 */
  lastMessageAt: string;
  unreadCount: number;
  createdAt: string;
}

// ------------------------------------------------------------------
// Connection / UI state
// ------------------------------------------------------------------
export type ConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error';

export type AIMode = 'ai' | 'human';

// ------------------------------------------------------------------
// API response wrappers
// ------------------------------------------------------------------
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ------------------------------------------------------------------
// Socket.io event payloads
// ------------------------------------------------------------------
export interface SocketIncomingMessage {
  conversationId: string;
  message: ChatMessage;
}

export interface SocketStatusUpdate {
  conversationId: string;
  aiMode: AIMode;
}
