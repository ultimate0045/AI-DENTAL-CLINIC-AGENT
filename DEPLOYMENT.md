# 🚢 Production Deployment Guide

This guide walks you through deploying the **WhatsApp AI Dental Receptionist SaaS** to production using **Vercel** (for the Next.js frontend) and **Railway** or **Render** (for the Node.js Express backend and Webhook).

---

## 🏗️ Architecture in Production

```
                                  ┌────────────────────────┐
                                  │   Meta WhatsApp API    │
                                  └───────────┬────────────┘
                                              │ Inbound Webhook & Outbound Messages
                                              ▼
┌────────────────────────┐         ┌────────────────────────┐
│  Next.js 14 Frontend   │ ◄─────► │   Express Server       │
│  (Vercel)              │  Socket │   (Railway / Render)   │
│  Port 443 (HTTPS)      │         │   Port 443 (HTTPS)     │
└───────────┬────────────┘         └───────────┬────────────┘
            │                                  │
            ▼                                  ▼
┌────────────────────────┐         ┌────────────────────────┐
│  Supabase (Auth + DB)  │         │  Google Cloud APIs     │
│  - Conversations       │         │  - Google Calendar     │
│  - Messages & RLS      │         │  - Google Sheets       │
│  - Clinic Settings     │         │  - Gemini 1.5 Flash    │
└────────────────────────┘         └────────────────────────┘
```

---

## 1. Deploy Backend (`server/server.js`) on Railway / Render

The backend needs a persistent Node.js environment to maintain Webhook listeners and WebSocket connections.

### Deploying on Railway (Recommended)
1. Fork or push this repository to GitHub.
2. Sign in to [Railway.app](https://railway.app/).
3. Click **New Project -> Deploy from GitHub repo**.
4. In Project Settings:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. In the **Variables** tab, add:
   ```ini
   PORT=3001
   NODE_ENV=production
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   META_VERIFY_TOKEN=your_secure_verify_token
   META_ACCESS_TOKEN=EAAG...
   META_PHONE_NUMBER_ID=109876543210987
   GOOGLE_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com
   GOOGLE_SHEET_ID=1A2B3C4D5E...
   GEMINI_API_KEY=AIzaSy...
   GEMINI_MODEL=gemini-1.5-flash
   NEXT_PUBLIC_CLIENT_URL=https://your-dental-saas.vercel.app
   ```
6. Click **Generate Domain** under Settings -> Networking. You will get a URL like `https://dental-backend-production.up.railway.app`.
7. Verify by opening `https://your-railway-url.up.railway.app/health` in your browser.

---

## 2. Deploy Frontend (Next.js) on Vercel

1. Sign in to [Vercel](https://vercel.com/).
2. Click **Add New -> Project** -> Import your GitHub repository.
3. Configure settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `./` (leave default)
4. Add Environment Variables:
   ```ini
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   NEXT_PUBLIC_SERVER_URL=https://your-railway-url.up.railway.app
   GOOGLE_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com
   GOOGLE_SHEET_ID=1A2B3C4D5E...
   GEMINI_API_KEY=AIzaSy...
   GEMINI_MODEL=gemini-1.5-flash
   META_PHONE_NUMBER_ID=109876543210987
   META_ACCESS_TOKEN=EAAG...
   ```
5. Click **Deploy**. Vercel will build and assign you a production URL (e.g., `https://your-dental-saas.vercel.app`).
6. Update `NEXT_PUBLIC_CLIENT_URL` in Railway to match your Vercel URL.

---

## 3. Configure Meta WhatsApp Webhook

1. Open [Meta for Developers](https://developers.facebook.com/).
2. Select your App -> **WhatsApp -> Configuration**.
3. In the **Webhook** section:
   - **Callback URL**: `https://your-railway-url.up.railway.app/webhook`
   - **Verify Token**: Enter the exact value configured in `META_VERIFY_TOKEN`.
4. Click **Verify and Save**. Meta will send a GET request to `/webhook` and verify the token.
5. In **Webhook Fields**, click **Manage** and subscribe to **`messages`**.

---

## 4. Production Checklist

- [ ] Supabase SQL schema executed from `supabase/schema.sql`.
- [ ] Admin user created in Supabase Authentication -> Users.
- [ ] Google Service Account granted **Editor** access on client's Google Sheet.
- [ ] Google Service Account granted **Make changes to events** on client's Google Calendar.
- [ ] Ran `npm run setup-sheets` or clicked **Setup Sheet Headers** in Dashboard.
- [ ] Meta Webhook verified and subscribed to `messages`.
- [ ] Sent a test message from a personal WhatsApp to clinic number: verified Gemini replied and slot was checked.
- [ ] Booked a test appointment: verified Google Calendar event created and Google Sheet row added.
- [ ] Toggled to **Human Mode** in dashboard: verified manual reply reached the patient's WhatsApp.
