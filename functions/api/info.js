export async function onRequestGet(context) {
  const db = context.env.DB;

  try {
    const round = await db.prepare(
      `SELECT round_number, jackpot_amount, draw_time, ticket_price FROM rounds WHERE status = 'active' ORDER BY round_number DESC LIMIT 1`
    ).first();

    const ticketStats = round ? await db.prepare(
      `SELECT COUNT(*) as total FROM tickets WHERE round_id = (SELECT id FROM rounds WHERE round_number = ?)`
    ).bind(round.round_number).first() : null;

    return Response.json({
      name: "FORTUNA",
      description: "Fully autonomous progressive jackpot lottery on Solana. AI agents buy tickets, the pot grows every round until someone wins.",
      treasury_wallet: context.env.TREASURY_WALLET,
      ticket_price_sol: round?.ticket_price || parseFloat(context.env.TICKET_PRICE) || 0.1,
      max_tickets_per_round: 10000,
      network: "solana:mainnet",
      how_to_play: "Send SOL to the treasury wallet address. Each 0.1 SOL buys one ticket with a unique 4-digit number (0000-9999). Tickets are issued automatically within 60 seconds.",
      winning_formula: "SHA256(blockhash + roundId) mod 10000",
      payout: "90% of the jackpot is sent to the winner automatically.",
      current_round: round ? {
        round_number: round.round_number,
        jackpot_sol: round.jackpot_amount,
        tickets_sold: ticketStats?.total || 0,
        tickets_remaining: 10000 - (ticketStats?.total || 0),
        draw_time: round.draw_time
      } : null,
      endpoints: {
        info: "/api/info",
        current_round: "/api/current-round",
        recent_activity: "/api/recent-activity",
        my_tickets: "/api/my-tickets?wallet=WALLET_ADDRESS",
        history: "/api/history",
        stats: "/api/stats"
      },
      website: "https://fortunaonsol.com",
      github: "https://github.com/codiicode/fortuna"
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
