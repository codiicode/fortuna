export async function onRequestGet(context) {
  const db = context.env.DB;

  try {
    const round = await db.prepare(
      `SELECT id FROM rounds WHERE status = 'active' ORDER BY round_number DESC LIMIT 1`
    ).first();

    if (!round) return Response.json({ activity: [] });

    const { results: activity } = await db.prepare(
      `SELECT
        wallet_address,
        COUNT(*) as ticket_count,
        MAX(created_at) as latest_purchase
      FROM tickets
      WHERE round_id = ?
      GROUP BY wallet_address, tx_signature
      ORDER BY latest_purchase DESC
      LIMIT 50`
    ).bind(round.id).all();

    return Response.json({ activity: activity || [] });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
