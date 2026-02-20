export async function onRequestGet(context) {
  const db = context.env.DB;

  try {
    let round = await db.prepare(
      `SELECT * FROM rounds WHERE status = 'active' ORDER BY round_number DESC LIMIT 1`
    ).first();

    if (!round) {
      await db.prepare(
        `INSERT INTO rounds (round_number, jackpot_amount, status, draw_time)
         VALUES (1, 0, 'active', datetime('now', '+1 day', 'start of day'))`
      ).run();
      round = await db.prepare(
        `SELECT * FROM rounds WHERE status = 'active' LIMIT 1`
      ).first();
    }

    const ticketStats = await db.prepare(
      `SELECT COUNT(*) as total, COUNT(DISTINCT wallet_address) as players
       FROM tickets WHERE round_id = ?`
    ).bind(round.id).first();

    return Response.json({
      ...round,
      total_tickets: ticketStats?.total || 0,
      unique_players: ticketStats?.players || 0
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
