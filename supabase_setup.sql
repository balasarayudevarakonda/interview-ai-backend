-- Run this in Supabase SQL Editor
-- supabase.com → your project → SQL Editor → paste → Run

CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  license_key TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  payment_id TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_license_key ON users(license_key);
