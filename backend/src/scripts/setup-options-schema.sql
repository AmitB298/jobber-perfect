-- Create options data table
CREATE TABLE IF NOT EXISTS nifty_premium_tracking.options_data (
    id SERIAL PRIMARY KEY,
    
    -- Instrument Info
    symbol VARCHAR(50) NOT NULL,              -- NIFTY, BANKNIFTY, etc.
    expiry_date DATE NOT NULL,                -- Expiry date
    strike_price DECIMAL(12, 2) NOT NULL,     -- Strike price
    option_type VARCHAR(2) NOT NULL,          -- CE or PE
    
    -- Exchange Info
    exchange VARCHAR(10) NOT NULL,            -- NSE, BSE
    trading_symbol VARCHAR(100) NOT NULL,     -- e.g., NIFTY26FEB2526000CE
    token VARCHAR(50) NOT NULL,               -- Symbol token
    
    -- Price Data
    ltp DECIMAL(12, 2),                       -- Last traded price
    open DECIMAL(12, 2),                      -- Open price
    high DECIMAL(12, 2),                      -- High price
    low DECIMAL(12, 2),                       -- Low price
    close DECIMAL(12, 2),                     -- Close price
    
    -- Order Book
    bid_price DECIMAL(12, 2),                 -- Best bid
    ask_price DECIMAL(12, 2),                 -- Best ask
    bid_qty INTEGER,                          -- Bid quantity
    ask_qty INTEGER,                          -- Ask quantity
    
    -- Volume & OI
    volume BIGINT,                            -- Volume
    oi BIGINT,                                -- Open Interest
    oi_change BIGINT,                         -- OI change
    
    -- Greeks (if available)
    iv DECIMAL(8, 4),                         -- Implied Volatility
    delta DECIMAL(8, 6),                      -- Delta
    gamma DECIMAL(8, 6),                      -- Gamma
    theta DECIMAL(8, 6),                      -- Theta
    vega DECIMAL(8, 6),                       -- Vega
    
    -- Metadata
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_options_timestamp 
ON nifty_premium_tracking.options_data(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_options_symbol_expiry 
ON nifty_premium_tracking.options_data(symbol, expiry_date);

CREATE INDEX IF NOT EXISTS idx_options_strike 
ON nifty_premium_tracking.options_data(strike_price, option_type);

CREATE INDEX IF NOT EXISTS idx_options_token 
ON nifty_premium_tracking.options_data(token);

-- Create view for latest options data
CREATE OR REPLACE VIEW nifty_premium_tracking.latest_options AS
SELECT DISTINCT ON (token) *
FROM nifty_premium_tracking.options_data
ORDER BY token, timestamp DESC;

SELECT 'Options schema created successfully!' as status;