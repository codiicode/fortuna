-- FORTUNA Database Schema

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_number INTEGER NOT NULL UNIQUE,
  jackpot_amount REAL NOT NULL DEFAULT 0,
  winning_number INTEGER,
  winner_wallet TEXT,
  draw_blockhash TEXT,
  draw_slot INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  draw_time TEXT,
  ticket_price REAL DEFAULT 0.1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  wallet_address TEXT NOT NULL,
  ticket_number INTEGER NOT NULL,
  tx_signature TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (round_id) REFERENCES rounds(id)
);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT NOT NULL,
  amount_sol REAL NOT NULL,
  tx_signature TEXT NOT NULL,
  refund_tx TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tickets_round ON tickets(round_id);
CREATE INDEX idx_tickets_wallet ON tickets(wallet_address);
CREATE UNIQUE INDEX idx_tickets_number ON tickets(round_id, ticket_number);
CREATE INDEX idx_rounds_status ON rounds(status);

-- Seed: first round (24h)
INSERT INTO rounds (round_number, jackpot_amount, status, draw_time, ticket_price)
VALUES (1, 0, 'active', datetime('now', '+1440 minutes'), 0.1);
