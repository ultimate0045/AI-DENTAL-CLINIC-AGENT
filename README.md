# 🦷 WhatsApp AI Dental Receptionist & Appointment Booking SaaS

[![Next.js 14](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)](https://nextjs.org/)
[![Node.js Express](https://img.shields.io/badge/Node.js-Express%20v4-green?logo=node.js)](https://nodejs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20Database-3ECF8E?logo=supabase)](https://supabase.com/)
[![Google Gemini API](https://img.shields.io/badge/Google-Gemini%201.5%20Flash-4285F4?logo=google)](https://aistudio.google.com/)
[![Google Sheets API](https://img.shields.io/badge/Google-Sheets%20API%20v4-34A853?logo=googlesheets)](https://developers.google.com/sheets/api)
[![Google Calendar API](https://img.shields.io/badge/Google-Calendar%20API%20v3-4285F4?logo=googlecalendar)](https://developers.google.com/calendar)
[![Meta WhatsApp Cloud API](https://img.shields.io/badge/Meta-WhatsApp%20Cloud%20API-25D366?logo=whatsapp)](https://developers.facebook.com/docs/whatsapp/cloud-api)

A production-ready, **100% white-label and reusable** WhatsApp AI Receptionist & Appointment Booking SaaS Dashboard designed specifically for Dental Clinics.

---

## 🌟 Key Architecture & White-Label Philosophy

> **CRITICAL RULE FOR REUSABILITY:**  
> **Zero hardcoded clinic names, doctor details, timings, Google Sheet IDs, Calendar IDs, or credentials.**  
> Everything is dynamically loaded via `.env.local` or the **Admin Settings Dashboard** (`/dashboard/settings`). You can clone this codebase and onboard a brand-new dental clinic client in under 5 minutes without touching application code.

---

## 🚀 Core Features

### 1. Direct Client Google Sheets Integration (Primary Client Database)
* Connects via Google Sheets API v4 using a single Google Service Account.
* The clinic's Google Sheet ID is configurable via `.env.local` or directly entered by the admin in the **Dashboard Settings** tab.
* **Auto-Sync across 2 primary tabs:**
  * **`Appointments` tab:** `Booking ID`, `Date`, `Time Slot`, `Patient Name`, `Phone Number`, `Dental Issue`, `Status (Confirmed/Cancelled)`, `Created Timestamp`.
  * **`Patients_Leads` tab:** `Patient Name`, `WhatsApp Number`, `First Contact Date`, `Last Query Summary`.
* **One-Click Header Initialization:** Includes both an in-dashboard **"Setup Sheet Headers"** button and a CLI script (`npm run setup-sheets`) to automatically create the required tabs and format headers in the client's blank Google Sheet.

### 2. Smart Google Calendar Appointment Booking (Gemini Function Calling)
* Real-time slot management using Google Calendar API v3 via Service Account (`GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`).
* **Gemini Tool 1 (`check_availability`)**: Inspects clinic working hours, lunch break (`13:00-14:00`), weekly off (e.g. Sunday), and existing Google Calendar bookings to calculate free 30-minute slots.
* **Gemini Tool 2 (`book_appointment`)**: Prevents race conditions / double bookings, creates the event in Google Calendar with dental issue details, appends the booking row into the client's Google Sheet `Appointments` tab, and logs the lead in `Patients_Leads`.
* **Empathetic System Prompt**: Respects doctor credentials, consultation fees, treatment catalog, FAQs, and medical disclaimers.

### 3. WhatsApp Web-Style Real-Time Admin Dashboard
* **Supabase Authentication**: Secure email/password login for clinic receptionists and doctors.
* **Socket.io Real-Time Engine**: Live chat updates as WhatsApp messages flow into the system.
* **Per-Chat AI / Human Mode Toggle**: Instant switch between **"AI Auto-Reply Mode"** (Gemini manages patient queries) and **"Human Receptionist Mode"** (receptionist types manual replies from the dashboard).
* **Live Integration Status Bar**: Continuous health check pills showing connection status for **Meta WhatsApp**, **Google Calendar**, and **Google Sheets**.
* **Dark / Light Mode**: Sleek WhatsApp Web dark mode theme (`#111B21`) alongside standard light mode.

### 4. Dynamic Clinic Settings & Knowledge Base (Admin Tab)
* Full configuration form for:
  * Clinic Name, Doctor Name, Address, Phone.
  * Working Hours, Lunch Breaks, Weekly Off Day, Consultation Fee.
  * Dynamic Treatment & Pricing Catalog with add/remove rows.
  * Clinic FAQ Bank (Questions & Answers).
  * `GOOGLE_SHEET_ID` and `GOOGLE_CALENDAR_ID` with inline **Test Connection** buttons.
* **Knowledge Base Document Uploader**: Upload clinic PDFs, service guides, or text files for additional AI context.

### 5. Meta Webhook & Deduplication Engine (`server/server.js`)
* Verification (`GET /webhook`) with `hub.challenge` and `META_VERIFY_TOKEN`.
* Webhook ingestion (`POST /webhook`) supporting inbound text messages and dental image attachments.
* **Deduplication Engine**: Uses Supabase `processed_messages` table to ensure duplicate WhatsApp retry webhooks never trigger multiple AI replies.

---

## 📂 Project Structure

```
├── app/
│   ├── api/
│   │   ├── conversations/             # List active conversations
│   │   │   └── [id]/
│   │   │       ├── messages/          # Conversation message history
│   │   │       └── toggle-ai/         # Toggle AI / Human mode per chat
│   │   ├── settings/                  # Clinic settings GET & POST
│   │   ├── sheets/
│   │   │   ├── setup/                 # Auto-create sheet tabs & headers
│   │   │   └── status/                # Check Google Sheet connection
│   │   └── upload-kb/                 # Knowledge base file upload
│   ├── dashboard/
│   │   ├── chat/[id]/page.tsx         # Active WhatsApp chat thread
│   │   ├── settings/page.tsx          # Clinic Admin Settings
│   │   ├── layout.tsx                 # Dashboard shell (Sidebar + StatusBar)
│   │   └── page.tsx                   # Overview & integration stats
│   ├── login/page.tsx                 # Supabase email/password login
│   ├── layout.tsx                     # Global Root layout
│   └── page.tsx                       # Redirects to /dashboard or /login
├── components/
│   ├── ui/                            # Radix + Tailwind primitives (Button, Switch, etc.)
│   ├── ChatWindow.tsx                 # WhatsApp Web chat window with AI/Human toggle
│   ├── SettingsForm.tsx               # 4-tab admin settings & integration manager
│   ├── Sidebar.tsx                    # WhatsApp-style chat list with badges & search
│   └── StatusBar.tsx                  # Real-time Meta / Calendar / Sheets status bar
├── hooks/
│   ├── useSocket.ts                   # Real-time WebSocket hook
│   └── useTheme.ts                    # Dark / Light mode hook
├── lib/
│   ├── gemini.ts                      # Gemini 1.5 Flash + Function Calling engine
│   ├── googleCalendar.ts              # Google Calendar v3 availability & booking
│   ├── googleSheets.ts                # Google Sheets v4 sync & header setup
│   ├── metaWhatsapp.ts                # Meta Cloud API message sender & media
│   ├── socket.ts                      # Client-side Socket.io instance
│   ├── supabase.ts                    # Supabase browser, server, and admin clients
│   └── utils.ts                       # Date/time slot helpers, formatting, booking IDs
├── scripts/
│   └── setupSheetHeaders.ts           # Standalone CLI script to initialize Google Sheets
├── server/
│   ├── package.json                   # Backend dependencies
│   └── server.js                      # Express, Socket.io, Meta Webhook, Gemini Runner
├── supabase/
│   └── schema.sql                     # Complete DB schema (Tables, RLS, Triggers, Views)
├── types/
│   └── index.ts                       # Shared TypeScript interfaces & types
├── .env.example                       # Complete environment variable template
├── DEPLOYMENT.md                      # Vercel & Railway deployment manual
└── README.md
```

---

## 🛠️ Step-by-Step Setup Guide

### 1. Prerequisites
- Node.js 18.x or 20.x
- A [Supabase](https://supabase.com) project
- A [Google Cloud Console](https://console.cloud.google.com) project with **Google Sheets API** and **Google Calendar API** enabled
- A [Meta for Developers](https://developers.facebook.com) App with WhatsApp Cloud API configured
- A [Google AI Studio](https://aistudio.google.com) API key for Gemini

---

### 2. Install Dependencies

```bash
# Install frontend Next.js dependencies
npm install

# Install Express backend dependencies
cd server
npm install
cd ..
```

---

### 3. Supabase Database Setup

1. Open your Supabase project dashboard -> **SQL Editor**.
2. Open `supabase/schema.sql` in this repo, copy its contents, and run it.
3. It creates:
   - `clinic_settings`: Singleton configuration row
   - `conversations`: WhatsApp chat threads
   - `chat_messages`: Complete message history
   - `processed_messages`: Webhook deduplication table
   - `appointments`: Appointments mirror
   - `knowledge_base`: Uploaded document chunks
   - Auto-updating timestamps and triggers.
4. Copy your **Project URL**, **Anon Key**, and **Service Role Key** from Supabase Settings -> API.

---

### 4. Google Service Account Setup (Sheets & Calendar)

Both Google Sheets and Google Calendar use the **same** Google Service Account:

1. In Google Cloud Console, enable:
   - **Google Sheets API**
   - **Google Calendar API**
2. Go to **IAM & Admin -> Service Accounts** -> Create Service Account (e.g. `dental-saas@...`).
3. Under the **Keys** tab, click **Add Key -> Create new key -> JSON**.
4. From the downloaded JSON:
   - Set `GOOGLE_CLIENT_EMAIL` to `client_email`.
   - Set `GOOGLE_PRIVATE_KEY` to `private_key` (keep `\n` in quotes).
5. **Share Google Calendar:** Open Google Calendar -> Settings for the clinic's calendar -> **Share with specific people** -> Paste the `client_email` and grant **"Make changes to events"**. Copy the Calendar ID.
6. **Share Google Sheet:** Create a new blank Google Sheet -> Click **Share** -> Paste the `client_email` and grant **"Editor"**. Copy the Sheet ID from the URL (`/spreadsheets/d/<ID>/edit`).

---

### 5. Meta WhatsApp Cloud API Setup

1. In Meta Developer Console, go to your WhatsApp App -> **Configuration**.
2. Set **Webhook URL** to: `https://your-server-url.com/webhook` (or your ngrok URL for local dev).
3. Set **Verify Token** to the same string you put in `META_VERIFY_TOKEN`.
4. Subscribe to the **`messages`** webhook field.
5. Copy your **Phone Number ID**, **WhatsApp Business Account ID**, and a System User **Permanent Access Token** into `META_ACCESS_TOKEN`.

---

### 6. Configure Environment Variables

Duplicate `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in your credentials:

```ini
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-id.supabase.co
SUPABASE_URL=https://your-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Meta WhatsApp
META_VERIFY_TOKEN=my_secure_webhook_token_123
META_ACCESS_TOKEN=EAAG...
META_PHONE_NUMBER_ID=109876543210987

# Google Service Account
GOOGLE_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgI...\n-----END PRIVATE KEY-----\n"

# Google Calendar & Sheet
GOOGLE_CALENDAR_ID=your_calendar@group.calendar.google.com
GOOGLE_SHEET_ID=1A2B3C4D5E6F7G8H9I0J...

# Gemini
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-1.5-flash

# Networking
PORT=3001
NEXT_PUBLIC_SERVER_URL=http://localhost:3001
NEXT_PUBLIC_CLIENT_URL=http://localhost:3000
```

---

### 7. Initialize Google Sheet Headers

You can initialize the sheet tabs and headers in either of two ways:

#### Option A: Via Dashboard (Recommended)
1. Start the app and navigate to **Settings -> Integrations**.
2. Enter the client's `GOOGLE_SHEET_ID` and click **"Test Connection"**.
3. Click **"Setup Sheet Headers"** -> Confirm.

#### Option B: Via CLI Script
```bash
npx ts-node scripts/setupSheetHeaders.ts
```

This creates:
- **`Appointments` tab:**
  `Booking ID` | `Date` | `Time Slot` | `Patient Name` | `Phone Number` | `Dental Issue` | `Status` | `Created Timestamp`
- **`Patients_Leads` tab:**
  `Patient Name` | `WhatsApp Number` | `First Contact Date` | `Last Query Summary`

---

## 🏃 Running the Application

Open two terminal windows:

```bash
# Terminal 1: Run Express + Socket.io + Webhook Backend
npm run server

# Terminal 2: Run Next.js Frontend
npm run dev
```

1. Next.js Dashboard: **`http://localhost:3000`**
2. Express Backend & Webhook: **`http://localhost:3001`**
3. Backend Health Check: **`http://localhost:3001/health`**
4. Integration Status Check: **`http://localhost:3001/api/status`**

To test incoming WhatsApp messages locally, expose port `3001` using ngrok:
```bash
ngrok http 3001
# Set Meta Webhook URL to: https://<your-ngrok-subdomain>.ngrok-free.app/webhook
```

---

## 📋 Client Onboarding Checklist (Duplicate in 5 Minutes)

When onboarding a new dental clinic client:
1. **Google Sheet**: Create blank Sheet -> Share with service account email as Editor -> Copy ID.
2. **Google Calendar**: Create clinic calendar -> Share with service account email -> Copy ID.
3. **Run Header Script**: Run `npx ts-node scripts/setupSheetHeaders.ts` with the new ID.
4. **Dashboard Settings**: Go to `/dashboard/settings` -> update Clinic Name, Doctor Name, Timings, Consultation Fee, Treatments list.
5. **WhatsApp**: Add clinic phone number in Meta Business Manager and point webhook to backend.

Done! The new dental clinic now has an autonomous 24/7 AI Receptionist booking appointments into their calendar and sheets.

---

## 📄 License
MIT License. Free for commercial dental SaaS deployments.
