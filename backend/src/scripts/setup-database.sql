-- Create schema
CREATE SCHEMA IF NOT EXISTS nifty_premium_tracking;

-- Create market_data table
CREATE TABLE IF NOT EXISTS nifty_premium_tracking.market_data (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    exchange VARCHAR(10) NOT NULL,
    ltp DECIMAL(12, 2) NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    user_id INTEGER NOT NULL,
    
    -- Indexes for performance
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create index on timestamp for fast queries
CREATE INDEX IF NOT EXISTS idx_market_data_timestamp 
ON nifty_premium_tracking.market_data(timestamp DESC);

-- Create index on symbol
CREATE INDEX IF NOT EXISTS idx_market_data_symbol 
ON nifty_premium_tracking.market_data(symbol);

-- Create hypertable for TimescaleDB (optional, if TimescaleDB is installed)
-- SELECT create_hypertable('nifty_premium_tracking.market_data', 'timestamp', if_not_exists => TRUE);

SELECT 'Database schema created successfully!' as status;