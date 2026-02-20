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

CREATE INDEX idx_tickets_round ON tickets(round_id);
CREATE INDEX idx_tickets_wallet ON tickets(wallet_address);
CREATE UNIQUE INDEX idx_tickets_number ON tickets(round_id, ticket_number);
CREATE INDEX idx_rounds_status ON rounds(status);

-- Seed: first round (10 min test)
INSERT INTO rounds (round_number, jackpot_amount, status, draw_time)
VALUES (1, 0, 'active', datetime('now', '+10 minutes'));
