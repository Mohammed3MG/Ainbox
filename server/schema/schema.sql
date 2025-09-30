CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  picture TEXT,
  -- Terms and conditions fields
  terms_version TEXT,
  terms_accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Connected provider accounts (Google/Microsoft). Store provider refresh token encrypted.
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'google' | 'microsoft'
  provider_account_id TEXT NOT NULL, -- e.g., Google profile id, Microsoft user id
  email TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  scopes TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_user_provider ON accounts(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

-- Smart Text Suggestions: User Writing Patterns
CREATE TABLE IF NOT EXISTS user_patterns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern_text TEXT NOT NULL,
  pattern_type VARCHAR(50) NOT NULL, -- 'greeting', 'closing', 'transition', 'phrase', 'sentence'
  context_data JSONB DEFAULT '{}', -- email context: formality, recipient_type, subject_keywords
  frequency INTEGER DEFAULT 1,
  acceptance_rate DECIMAL(5,4) DEFAULT 0.0000, -- percentage of times accepted when shown
  total_shown INTEGER DEFAULT 0, -- total times this pattern was suggested
  total_accepted INTEGER DEFAULT 0, -- total times user accepted it
  last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Smart Text Suggestions: Detailed Metrics for Each Suggestion
CREATE TABLE IF NOT EXISTS suggestion_metrics (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  suggestion_text TEXT NOT NULL,
  action VARCHAR(20) NOT NULL, -- 'shown', 'accepted', 'rejected', 'ignored', 'dismissed'
  context_data JSONB DEFAULT '{}', -- context when suggestion was made
  response_time_ms INTEGER, -- milliseconds between show and action
  cursor_position INTEGER, -- where in text the suggestion was made
  text_length INTEGER, -- total length of text when suggested
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_patterns_user_id ON user_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_user_patterns_type ON user_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_user_patterns_acceptance ON user_patterns(acceptance_rate DESC);
CREATE INDEX IF NOT EXISTS idx_user_patterns_frequency ON user_patterns(frequency DESC);
CREATE INDEX IF NOT EXISTS idx_user_patterns_last_used ON user_patterns(last_used DESC);

CREATE INDEX IF NOT EXISTS idx_suggestion_metrics_user_id ON suggestion_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_suggestion_metrics_action ON suggestion_metrics(action);
CREATE INDEX IF NOT EXISTS idx_suggestion_metrics_created_at ON suggestion_metrics(created_at DESC);
