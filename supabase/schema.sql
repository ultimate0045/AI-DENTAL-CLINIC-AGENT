-- =============================================================================
-- WhatsApp AI Dental Receptionist SaaS — Supabase Database Schema
-- =============================================================================
-- Apply this file once against a fresh Supabase project via the SQL editor
-- or `supabase db push`. All objects are idempotent (IF NOT EXISTS / OR REPLACE).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------
-- pgcrypto supplies gen_random_uuid() used in every table's primary key.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =============================================================================
-- SECTION 1 — TABLES
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. clinic_settings
-- ---------------------------------------------------------------------------
-- Singleton table (one row per deployment).  Stores every piece of
-- configurable clinic information: opening hours, fee, service menu, FAQs,
-- and pointers to external Google resources.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_settings (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Basic clinic identity
  clinic_name          TEXT        NOT NULL DEFAULT '',
  doctor_name          TEXT        NOT NULL DEFAULT '',
  address              TEXT        DEFAULT '',
  phone                TEXT        DEFAULT '',

  -- Working hours
  timings_start        TIME        DEFAULT '09:00',
  timings_end          TIME        DEFAULT '18:00',
  lunch_start          TIME        DEFAULT '13:00',
  lunch_end            TIME        DEFAULT '14:00',

  -- Weekly closure day (e.g. 'Sunday', 'Saturday')
  weekly_off           TEXT        DEFAULT 'Sunday',

  -- Pricing
  consultation_fee     INTEGER     DEFAULT 0,

  -- Service catalogue — array of {name, price, duration_mins}
  services             JSONB       DEFAULT '[]'::jsonb,

  -- FAQ bank — array of {question, answer}
  faqs                 JSONB       DEFAULT '[]'::jsonb,

  -- Google integrations
  google_sheet_id      TEXT        DEFAULT '',
  google_calendar_id   TEXT        DEFAULT '',

  -- WhatsApp Meta Integrations (Configurable via Dashboard UI)
  meta_access_token           TEXT        DEFAULT '',
  meta_phone_number_id        TEXT        DEFAULT '',
  meta_verify_token           TEXT        DEFAULT '',

  -- AI & Credentials Overrides (Optional overrides via Dashboard UI)
  gemini_api_key              TEXT        DEFAULT '',
  gemini_model                TEXT        DEFAULT '',
  google_service_account_json TEXT        DEFAULT '',

  -- Uploaded knowledge base (PDF / plain-text content for the AI)
  knowledge_base_text  TEXT        DEFAULT '',

  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  clinic_settings IS 'Singleton row that holds all configurable clinic settings.';
COMMENT ON COLUMN clinic_settings.services IS 'Array of service objects: [{name, price, duration_mins}]';
COMMENT ON COLUMN clinic_settings.faqs     IS 'Array of FAQ objects: [{question, answer}]';

-- Idempotent column migrations for existing databases
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS meta_access_token TEXT DEFAULT '';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS meta_phone_number_id TEXT DEFAULT '';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS meta_verify_token TEXT DEFAULT '';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS gemini_api_key TEXT DEFAULT '';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS gemini_model TEXT DEFAULT '';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS google_service_account_json TEXT DEFAULT '';


-- ---------------------------------------------------------------------------
-- 2. conversations
-- ---------------------------------------------------------------------------
-- One row per unique WhatsApp phone number.  Acts as the "inbox" thread header
-- shown in the dashboard sidebar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The WhatsApp sender number, e.g. "+919876543210"
  phone_number     TEXT        UNIQUE NOT NULL,

  patient_name     TEXT        DEFAULT '',
  last_message     TEXT        DEFAULT '',
  last_message_at  TIMESTAMPTZ DEFAULT NOW(),

  -- When FALSE, a human agent has taken over this conversation
  ai_mode          BOOLEAN     DEFAULT TRUE,

  -- Incremented on every inbound user message; reset by the dashboard
  unread_count     INTEGER     DEFAULT 0,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  conversations IS 'One row per WhatsApp contact — the top-level chat thread.';
COMMENT ON COLUMN conversations.ai_mode IS 'TRUE = AI handles replies; FALSE = human agent has taken over.';

-- Indexes for sidebar list (ordered by recency) and webhook lookups (by phone)
CREATE INDEX IF NOT EXISTS idx_conversations_phone        ON conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);


-- ---------------------------------------------------------------------------
-- 3. chat_messages
-- ---------------------------------------------------------------------------
-- Every individual message (inbound from patient, outbound from AI/agent,
-- or internal system notes) stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  conversation_id      UUID        NOT NULL
                                   REFERENCES conversations(id) ON DELETE CASCADE,

  -- 'user' = patient, 'assistant' = AI/agent, 'system' = internal note
  role                 TEXT        NOT NULL
                                   CHECK (role IN ('user', 'assistant', 'system')),

  content              TEXT        NOT NULL,

  -- Extends to multi-modal messages
  message_type         TEXT        DEFAULT 'text'
                                   CHECK (message_type IN ('text', 'image', 'audio', 'document')),
  media_url            TEXT,

  -- Meta Cloud API message ID for deduplication and status tracking
  whatsapp_message_id  TEXT,

  created_at           TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  chat_messages IS 'Full message log for every conversation.';
COMMENT ON COLUMN chat_messages.role IS 'user=patient, assistant=AI/human agent, system=internal.';
COMMENT ON COLUMN chat_messages.whatsapp_message_id IS 'The wamid from the Meta Cloud API payload.';

-- Primary read path: fetch recent messages for a conversation
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat_messages(conversation_id, created_at DESC);
-- Webhook deduplication lookup
CREATE INDEX IF NOT EXISTS idx_messages_wa_id        ON chat_messages(whatsapp_message_id);


-- ---------------------------------------------------------------------------
-- 4. processed_messages
-- ---------------------------------------------------------------------------
-- Deduplication guard: the backend inserts a row here before processing each
-- incoming WhatsApp message.  If the row already exists, the message is a
-- duplicate and processing is skipped.
-- Records older than 24 hours can be pruned by cleanup_old_processed_messages().
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_messages (
  -- The WhatsApp message ID (wamid) used directly as PK for fast upsert
  message_id       TEXT        PRIMARY KEY,
  processed_at     TIMESTAMPTZ DEFAULT NOW(),
  conversation_id  UUID        REFERENCES conversations(id)
);

COMMENT ON TABLE processed_messages IS 'Idempotency table — prevents double-processing of WhatsApp webhooks.';

-- Used by the cleanup function and for time-based queries
CREATE INDEX IF NOT EXISTS idx_processed_messages_time ON processed_messages(processed_at);


-- ---------------------------------------------------------------------------
-- 5. appointments
-- ---------------------------------------------------------------------------
-- Local mirror of the Google Sheet bookings.  Kept in sync by the backend so
-- the dashboard can query and filter appointments without hitting Sheets every
-- time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-readable booking reference, e.g. "BK-20241115-0001"
  booking_id       TEXT        UNIQUE NOT NULL,

  conversation_id  UUID        REFERENCES conversations(id),

  patient_name     TEXT        NOT NULL,
  patient_phone    TEXT        NOT NULL,
  dental_issue     TEXT,

  appointment_date DATE        NOT NULL,
  time_slot        TEXT        NOT NULL,   -- e.g. "10:00 AM"

  -- Lifecycle status
  status           TEXT        DEFAULT 'Confirmed'
                               CHECK (status IN ('Confirmed', 'Cancelled', 'Completed', 'No-Show')),

  -- Google Calendar event ID for quick lookup / deletion
  google_event_id  TEXT,

  -- Row number inside the Google Sheet (for targeted updates)
  google_sheet_row INTEGER,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  appointments IS 'Local mirror of Google Sheets appointments for dashboard queries.';
COMMENT ON COLUMN appointments.booking_id        IS 'Human-readable booking reference shared with the patient.';
COMMENT ON COLUMN appointments.google_sheet_row  IS 'Row number in Google Sheet for targeted update/delete.';

CREATE INDEX IF NOT EXISTS idx_appointments_date   ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_phone  ON appointments(patient_phone);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);


-- ---------------------------------------------------------------------------
-- 6. knowledge_base
-- ---------------------------------------------------------------------------
-- Optional RAG (Retrieval-Augmented Generation) chunk store.  Uploaded
-- documents are split and stored here so the AI can retrieve relevant
-- passages at query time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_base (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name  TEXT        NOT NULL,          -- e.g. "clinic_brochure.pdf"
  content      TEXT        NOT NULL,          -- text chunk
  metadata     JSONB       DEFAULT '{}'::jsonb, -- e.g. {page, chunk_index, token_count}
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  knowledge_base IS 'RAG chunks derived from uploaded clinic documents.';
COMMENT ON COLUMN knowledge_base.metadata IS 'Arbitrary chunk metadata: {page, chunk_index, token_count, …}';


-- =============================================================================
-- SECTION 2 — FUNCTIONS & TRIGGERS
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 2.1  update_updated_at()
-- ---------------------------------------------------------------------------
-- Generic trigger function: sets updated_at = NOW() before every UPDATE.
-- Applied to clinic_settings, conversations, and appointments.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Apply to clinic_settings
DROP TRIGGER IF EXISTS trg_clinic_settings_updated_at ON clinic_settings;
CREATE TRIGGER trg_clinic_settings_updated_at
  BEFORE UPDATE ON clinic_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Apply to conversations
DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Apply to appointments
DROP TRIGGER IF EXISTS trg_appointments_updated_at ON appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ---------------------------------------------------------------------------
-- 2.2  update_conversation_on_message()
-- ---------------------------------------------------------------------------
-- After every INSERT into chat_messages:
--   • Copies the new message content (truncated to 100 chars) into the parent
--     conversation's last_message column.
--   • Stamps last_message_at with the message's own created_at.
--   • If the message came from the patient ('user'), increments unread_count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE conversations
  SET
    last_message    = LEFT(NEW.content, 100),
    last_message_at = NEW.created_at,
    unread_count    = CASE
                        WHEN NEW.role = 'user'
                          THEN unread_count + 1
                        ELSE unread_count
                      END,
    updated_at      = NOW()
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_update_conversation ON chat_messages;
CREATE TRIGGER trg_chat_messages_update_conversation
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();


-- ---------------------------------------------------------------------------
-- 2.3  cleanup_old_processed_messages()
-- ---------------------------------------------------------------------------
-- Deletes deduplication rows older than 24 hours.
-- Call this manually, via a Supabase Edge Function cron, or pg_cron:
--   SELECT cron.schedule('cleanup-processed-msgs', '0 * * * *',
--     'SELECT cleanup_old_processed_messages()');
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_old_processed_messages()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM processed_messages
  WHERE processed_at < NOW() - INTERVAL '24 hours';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_old_processed_messages() IS
  'Prune processed_messages rows older than 24 h. Returns the number of rows deleted.';


-- =============================================================================
-- SECTION 3 — VIEWS
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 3.1  conversation_summary
-- ---------------------------------------------------------------------------
-- Denormalised view consumed by the dashboard sidebar.  For each conversation
-- it surfaces the most recent message text, plus a count of appointments
-- linked to that contact's phone number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW conversation_summary AS
SELECT
  c.id,
  c.phone_number,
  c.patient_name,
  c.last_message,
  c.last_message_at,
  c.ai_mode,
  c.unread_count,
  c.created_at,
  c.updated_at,

  -- Total messages (all roles) in the thread
  COUNT(DISTINCT cm.id)                             AS total_messages,

  -- Appointment statistics for this contact
  COUNT(DISTINCT a.id)                              AS total_appointments,
  COUNT(DISTINCT a.id) FILTER (
    WHERE a.status = 'Confirmed')                   AS confirmed_appointments,
  COUNT(DISTINCT a.id) FILTER (
    WHERE a.status = 'Completed')                   AS completed_appointments,
  COUNT(DISTINCT a.id) FILTER (
    WHERE a.status = 'Cancelled')                   AS cancelled_appointments,

  -- Next upcoming appointment date for this contact
  MIN(a.appointment_date) FILTER (
    WHERE a.appointment_date >= CURRENT_DATE
      AND a.status = 'Confirmed')                   AS next_appointment_date

FROM conversations c
LEFT JOIN chat_messages cm ON cm.conversation_id = c.id
LEFT JOIN appointments  a  ON a.patient_phone     = c.phone_number
GROUP BY c.id;

COMMENT ON VIEW conversation_summary IS
  'Aggregated conversation view used by the dashboard sidebar — message count, appointment stats, next booking.';


-- =============================================================================
-- SECTION 4 — ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- All tables have RLS enabled.
-- Dashboard users authenticate via Supabase Auth (JWT) — policies use
-- auth.uid() IS NOT NULL.
-- The Express backend uses the service_role key which bypasses RLS entirely,
-- so no explicit service-role policy is required for backend tables.
-- processed_messages is intentionally restricted to service_role only.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
ALTER TABLE clinic_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base      ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- clinic_settings — authenticated users have full access
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "clinic_settings_select" ON clinic_settings;
CREATE POLICY "clinic_settings_select"
  ON clinic_settings FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "clinic_settings_insert" ON clinic_settings;
CREATE POLICY "clinic_settings_insert"
  ON clinic_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "clinic_settings_update" ON clinic_settings;
CREATE POLICY "clinic_settings_update"
  ON clinic_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "clinic_settings_delete" ON clinic_settings;
CREATE POLICY "clinic_settings_delete"
  ON clinic_settings FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------------------------------------------------------------------------
-- conversations — authenticated users have full access
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "conversations_select" ON conversations;
CREATE POLICY "conversations_select"
  ON conversations FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "conversations_insert" ON conversations;
CREATE POLICY "conversations_insert"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "conversations_update" ON conversations;
CREATE POLICY "conversations_update"
  ON conversations FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "conversations_delete" ON conversations;
CREATE POLICY "conversations_delete"
  ON conversations FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------------------------------------------------------------------------
-- chat_messages — authenticated users have full access
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "chat_messages_select" ON chat_messages;
CREATE POLICY "chat_messages_select"
  ON chat_messages FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "chat_messages_insert" ON chat_messages;
CREATE POLICY "chat_messages_insert"
  ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "chat_messages_update" ON chat_messages;
CREATE POLICY "chat_messages_update"
  ON chat_messages FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "chat_messages_delete" ON chat_messages;
CREATE POLICY "chat_messages_delete"
  ON chat_messages FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------------------------------------------------------------------------
-- processed_messages — service role only (no anon / authenticated policies)
-- ---------------------------------------------------------------------------
-- The Express backend uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- No dashboard user should ever read or write this table directly, so we
-- intentionally create NO policies — all non-service-role access is denied.
-- (Leaving a comment here so the intent is explicit and not mistaken for an
--  omission.)


-- ---------------------------------------------------------------------------
-- appointments — authenticated users have full access
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "appointments_select" ON appointments;
CREATE POLICY "appointments_select"
  ON appointments FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "appointments_insert" ON appointments;
CREATE POLICY "appointments_insert"
  ON appointments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "appointments_update" ON appointments;
CREATE POLICY "appointments_update"
  ON appointments FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "appointments_delete" ON appointments;
CREATE POLICY "appointments_delete"
  ON appointments FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------------------------------------------------------------------------
-- knowledge_base — authenticated users have full access
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "knowledge_base_select" ON knowledge_base;
CREATE POLICY "knowledge_base_select"
  ON knowledge_base FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "knowledge_base_insert" ON knowledge_base;
CREATE POLICY "knowledge_base_insert"
  ON knowledge_base FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "knowledge_base_update" ON knowledge_base;
CREATE POLICY "knowledge_base_update"
  ON knowledge_base FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "knowledge_base_delete" ON knowledge_base;
CREATE POLICY "knowledge_base_delete"
  ON knowledge_base FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- =============================================================================
-- SECTION 5 — INITIAL SEED DATA
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Default clinic_settings row
-- ---------------------------------------------------------------------------
-- Inserted once so the settings page always finds a row to UPDATE rather than
-- having to check existence first.  clinic_name / doctor_name are intentionally
-- blank — the operator fills them in via the dashboard.
-- ---------------------------------------------------------------------------
INSERT INTO clinic_settings (clinic_name, doctor_name, timings_start, timings_end)
VALUES ('', '', '09:00', '18:00')
ON CONFLICT DO NOTHING;


-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
