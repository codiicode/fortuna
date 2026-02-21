export async function onRequestGet(context) {
  const db = context.env.DB;

  try {
    const roundStats = await db.prepare(
      `SELECT COUNT(*) as total_rounds FROM rounds WHERE status = 'drawn'`
    ).first();

    const paidStats = await db.prepare(
      `SELECT COALESCE(SUM(jackpot_amount * 0.9), 0) as total_paid
       FROM rounds WHERE status = 'drawn' AND winner_wallet IS NOT NULL`
    ).first();

    return Response.json({
      total_rounds: roundStats?.total_rounds || 0,
      total_paid_sol: paidStats?.total_paid || 0
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
