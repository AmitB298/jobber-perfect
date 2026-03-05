\c jobber_pro
SET search_path = nifty_premium_tracking, public;

CREATE TABLE IF NOT EXISTS nifty_premium_tracking.spoof_alerts (
    id            BIGSERIAL    PRIMARY KEY,
    detected_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    token         TEXT         NOT NULL,
    symbol        TEXT         NOT NULL,
    strike        INTEGER      NOT NULL,
    option_type   CHAR(2)      NOT NULL,
    alert_type    TEXT         NOT NULL,
    severity      TEXT         NOT NULL,
    state         TEXT         NOT NULL,
    regime        TEXT         NOT NULL,
    phase         TEXT         NOT NULL,
    ensemble      NUMERIC(5,1) NOT NULL,
    confidence    NUMERIC(5,4) NOT NULL,
    ltp           NUMERIC(10,2),
    bid_price     NUMERIC(10,2),
    ask_price     NUMERIC(10,2),
    bid_qty       INTEGER,
    ask_qty       INTEGER,
    oi            BIGINT,
    oi_change     INTEGER,
    ltp_change    NUMERIC(10,2),
    bid_ask_ratio NUMERIC(6,3),
    spread_pct    NUMERIC(6,3),
    action        TEXT,
    explanation   TEXT,
    payload       JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_spoof_alerts_time   ON nifty_premium_tracking.spoof_alerts(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_spoof_alerts_state  ON nifty_premium_tracking.spoof_alerts(state, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_spoof_alerts_strike ON nifty_premium_tracking.spoof_alerts(strike, option_type, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_spoof_alerts_type   ON nifty_premium_tracking.spoof_alerts(alert_type, detected_at DESC);

SELECT 'spoof_alerts table ready ✅' AS status;
SELECT COUNT(*) AS existing_rows FROM nifty_premium_tracking.spoof_alerts;
