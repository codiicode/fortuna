export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const wallet = url.searchParams.get('wallet');

  if (!wallet) return Response.json({ tickets: [] });

  try {
    const round = await db.prepare(
      `SELECT * FROM rounds WHERE status = 'active' ORDER BY round_number DESC LIMIT 1`
    ).first();

    if (!round) return Response.json({ tickets: [] });

    const { results: tickets } = await db.prepare(
      `SELECT id, ticket_number, created_at FROM tickets
       WHERE round_id = ? AND wallet_address = ?
       ORDER BY created_at DESC`
    ).bind(round.id, wallet).all();

    return Response.json({
      tickets: (tickets || []).map(t => ({
        id: t.id,
        number: t.ticket_number,
        round_id: round.round_number
      }))
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
