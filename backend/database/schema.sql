-- JOBBER Pro Database Schema - PRODUCTION READY
-- PostgreSQL 14+
-- FIXES: Added missing constraints, indexes, and security

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- For encryption functions

-- ============================================================================
-- USERS TABLE
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    mobile VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    
    -- IMPROVEMENT: Email verification
    email_verified BOOLEAN DEFAULT false,
    email_verification_token VARCHAR(255),
    email_verification_expires TIMESTAMP,
    
    -- Plan management
    plan VARCHAR(20) NOT NULL DEFAULT 'TRIAL' 
        CHECK (plan IN ('TRIAL', 'PAID', 'EXPIRED')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' 
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'BLOCKED')),
    
    -- Trial tracking
    trial_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    trial_end_date TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
    
    -- Subscription tracking
    subscription_start_date TIMESTAMP,
    subscription_end_date TIMESTAMP,
    subscription_id VARCHAR(255), -- External payment system ID
    
    -- Permissions
    permissions TEXT[] DEFAULT ARRAY['basic']::TEXT[],
    
    -- IMPROVEMENT: Failed login tracking
    failed_login_attempts INTEGER DEFAULT 0,
    last_failed_login TIMESTAMP,
    account_locked_until TIMESTAMP,
    
    -- IMPROVEMENT: Password reset
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP,
    
    -- Metadata
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- FIX: Additional constraints
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'),
    CONSTRAINT valid_trial_dates CHECK (trial_end_date > trial_start_date),
    CONSTRAINT valid_subscription_dates CHECK (
        subscription_end_date IS NULL OR 
        subscription_end_date > subscription_start_date
    )
);

-- ============================================================================
-- DEVICE FINGERPRINTS TABLE
-- ============================================================================
CREATE TABLE device_fingerprints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Device identification
    device_id VARCHAR(255) NOT NULL,
    machine_id VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL 
        CHECK (platform IN ('win32', 'darwin', 'linux')),
    os_version VARCHAR(100),
    
    -- Hardware info
    cpu_model VARCHAR(255),
    cpu_cores INTEGER CHECK (cpu_cores > 0 AND cpu_cores <= 256),
    total_memory BIGINT CHECK (total_memory > 0),
    mac_address VARCHAR(17),
    disk_serial VARCHAR(255),
    
    -- Fingerprint hash
    fingerprint VARCHAR(64) UNIQUE NOT NULL,
    
    -- Device status
    is_primary BOOLEAN DEFAULT false,
    is_trusted BOOLEAN DEFAULT false, -- NEW: For future MFA
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- IMPROVEMENT: Device metadata
    device_name VARCHAR(255),
    browser_fingerprint TEXT, -- For web version if needed
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- FIX: Ensure one fingerprint per user
    UNIQUE(user_id, fingerprint),
    
    -- FIX: Only one primary device per user
    UNIQUE(user_id, is_primary) WHERE is_primary = true
);

-- ============================================================================
-- ANGEL ONE BINDINGS TABLE
-- ============================================================================
CREATE TABLE angel_bindings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    angel_client_id VARCHAR(50) NOT NULL,
    device_fingerprint VARCHAR(64) NOT NULL 
        REFERENCES device_fingerprints(fingerprint) ON DELETE CASCADE,
    
    -- IMPROVEMENT: Store Angel profile
    angel_name VARCHAR(255),
    angel_email VARCHAR(255),
    angel_mobile VARCHAR(20),
    
    -- Binding status
    is_active BOOLEAN DEFAULT true,
    last_verified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    bound_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unbound_at TIMESTAMP,
    
    -- FIX: Enforce 1:1 mapping
    UNIQUE(angel_client_id),
    UNIQUE(user_id, angel_client_id),
    
    -- FIX: One active binding per user
    UNIQUE(user_id, is_active) WHERE is_active = true
);

-- ============================================================================
-- REFRESH TOKENS TABLE
-- ============================================================================
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    
    -- IMPROVEMENT: Token family for rotation detection
    token_family VARCHAR(255),
    
    -- Token lifecycle
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP,
    
    -- IMPROVEMENT: Revocation reason
    revoked_reason VARCHAR(100),
    
    -- IMPROVEMENT: Device tracking
    device_fingerprint VARCHAR(64) 
        REFERENCES device_fingerprints(fingerprint) ON DELETE SET NULL,
    
    -- FIX: Check token not expired on creation
    CONSTRAINT valid_expiry CHECK (expires_at > created_at),
    
    -- FIX: If revoked, must have timestamp
    CONSTRAINT valid_revocation CHECK (
        (revoked_at IS NULL AND revoked_reason IS NULL) OR
        (revoked_at IS NOT NULL)
    )
);

-- ============================================================================
-- AUDIT LOGS TABLE (COMPLIANCE)
-- ============================================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Action details
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100),
    resource_id VARCHAR(255),
    
    -- Request context
    ip_address INET,
    user_agent TEXT,
    
    -- IMPROVEMENT: Geo-location
    country VARCHAR(2),
    city VARCHAR(255),
    
    -- Additional details
    details JSONB,
    
    -- IMPROVEMENT: Success/failure tracking
    status VARCHAR(20) DEFAULT 'success' 
        CHECK (status IN ('success', 'failure', 'error')),
    error_message TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- FIX: Partition-ready (for scaling)
    CHECK (created_at >= DATE '2024-01-01')
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Users indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_plan_status ON users(plan, status);
CREATE INDEX idx_users_trial_end ON users(trial_end_date) 
    WHERE plan = 'TRIAL';
CREATE INDEX idx_users_subscription_end ON users(subscription_end_date) 
    WHERE plan = 'PAID';
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- Device fingerprints indexes
CREATE INDEX idx_device_fingerprints_user_id ON device_fingerprints(user_id);
CREATE INDEX idx_device_fingerprints_fingerprint ON device_fingerprints(fingerprint);
CREATE INDEX idx_device_fingerprints_last_seen ON device_fingerprints(last_seen DESC);
CREATE INDEX idx_device_fingerprints_is_primary ON device_fingerprints(user_id, is_primary) 
    WHERE is_primary = true;

-- Angel bindings indexes
CREATE INDEX idx_angel_bindings_user_id ON angel_bindings(user_id);
CREATE INDEX idx_angel_bindings_client_id ON angel_bindings(angel_client_id);
CREATE INDEX idx_angel_bindings_active ON angel_bindings(user_id, is_active) 
    WHERE is_active = true;

-- Refresh tokens indexes
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(token_family);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at) 
    WHERE revoked_at IS NULL;

-- Audit logs indexes (optimized for queries)
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource, resource_id);
CREATE INDEX idx_audit_logs_status ON audit_logs(status, created_at DESC);

-- FIX: GIN index for JSONB details
CREATE INDEX idx_audit_logs_details ON audit_logs USING GIN (details);

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_device_fingerprints_updated_at BEFORE UPDATE ON device_fingerprints
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to check and expire trials
CREATE OR REPLACE FUNCTION check_trial_expiry()
RETURNS INTEGER AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE users
    SET plan = 'EXPIRED'
    WHERE plan = 'TRIAL'
    AND trial_end_date < CURRENT_TIMESTAMP;
    
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- IMPROVEMENT: Function to clean old audit logs
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM audit_logs
    WHERE created_at < CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- IMPROVEMENT: Function to clean expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM refresh_tokens
    WHERE expires_at < CURRENT_TIMESTAMP
    OR revoked_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Active users view
CREATE OR REPLACE VIEW active_users AS
SELECT 
    u.id,
    u.email,
    u.plan,
    u.status,
    u.trial_end_date,
    u.subscription_end_date,
    u.last_login_at,
    COUNT(DISTINCT df.id) as device_count,
    COUNT(DISTINCT ab.id) as angel_bindings_count
FROM users u
LEFT JOIN device_fingerprints df ON u.id = df.user_id
LEFT JOIN angel_bindings ab ON u.id = ab.user_id AND ab.is_active = true
WHERE u.status = 'ACTIVE'
GROUP BY u.id;

-- Trial expiry report
CREATE OR REPLACE VIEW trial_expiry_report AS
SELECT 
    DATE(trial_end_date) as expiry_date,
    COUNT(*) as users_expiring,
    COUNT(*) FILTER (WHERE email_verified = true) as verified_users
FROM users
WHERE plan = 'TRIAL'
AND trial_end_date >= CURRENT_DATE
AND trial_end_date <= CURRENT_DATE + INTERVAL '7 days'
GROUP BY DATE(trial_end_date)
ORDER BY expiry_date;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE users IS 'User accounts with trial and subscription tracking';
COMMENT ON TABLE device_fingerprints IS 'Hardware fingerprints for fraud prevention (one trial user = one device)';
COMMENT ON TABLE angel_bindings IS 'Angel One broker account bindings with 1:1 mapping enforcement';
COMMENT ON TABLE refresh_tokens IS 'JWT refresh tokens with family tracking for rotation detection';
COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail for SEBI compliance';

COMMENT ON COLUMN users.email_verified IS 'Whether email has been verified via confirmation link';
COMMENT ON COLUMN users.failed_login_attempts IS 'Counter for brute-force protection';
COMMENT ON COLUMN refresh_tokens.token_family IS 'Token family ID for detecting token theft via rotation';
COMMENT ON COLUMN audit_logs.details IS 'JSONB field for flexible audit data (indexed with GIN)';

-- ============================================================================
-- SECURITY: REVOKE PUBLIC ACCESS
-- ============================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Grant to application user (create this user separately)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jobber_app;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jobber_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO jobber_app;

-- ============================================================================
-- INITIAL DATA
-- ============================================================================

-- Set default database settings for performance
ALTER DATABASE jobber_pro SET timezone TO 'UTC';
ALTER DATABASE jobber_pro SET default_transaction_isolation TO 'read committed';
