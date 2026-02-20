# FORTUNA

Provably fair progressive jackpot on Solana. The pot grows every round until someone wins.

## How it works

1. Players buy tickets (0.03 SOL each), each ticket gets a random 4-digit number (0000–9999)
2. When the countdown ends, a winning number is drawn using a Solana blockhash
3. Match all 4 digits → claim the jackpot
4. No winner → the entire pot rolls over to the next round

**Winning number:** `SHA256(blockhash + roundId) mod 10000`

Every draw is verifiable on-chain.

## Tokenomics

| Allocation | Share | Description |
|------------|-------|-------------|
| Jackpot | 90% | Paid to the winner |
| Community | 7.5% | Burns, locks, giveaways |
| Protocol | 2.5% | Development & operations |

## Architecture

- **Frontend:** Static HTML served via Cloudflare Pages
- **Backend:** Cloudflare Pages Functions (serverless)
- **Database:** Cloudflare D1 (SQLite at the edge)
- **Cron:** Cloudflare Worker — triggers draws automatically
- **RPC:** Proxied through backend to keep API keys server-side

```
public/             → Frontend
functions/api/      → Backend API endpoints
cron-worker/        → Scheduled draw trigger
schema.sql          → Database schema
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/current-round` | GET | Active round with jackpot, countdown, ticket count |
| `/api/my-tickets?wallet=` | GET | Tickets for a given wallet in the current round |
| `/api/history` | GET | Last 20 completed rounds |
| `/api/process-deposits` | POST | Detect SOL transfers and issue tickets |
| `/api/draw` | POST | Execute draw (requires `DRAW_SECRET`) |
| `/api/rpc` | POST | Solana RPC proxy (allowlisted methods only) |
| `/api/stats` | GET | Aggregate stats |

## Setup

```bash
# Install wrangler
npm install -g wrangler

# Create D1 database
npm run db:create

# Initialize schema
npm run db:init

# Set secrets
wrangler pages secret put SOLANA_RPC
wrangler pages secret put DRAW_SECRET
wrangler pages secret put TREASURY_PRIVATE_KEY

# Deploy
npm run deploy
```

## License

MIT
