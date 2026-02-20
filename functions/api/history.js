export async function onRequestGet(context) {
  const db = context.env.DB;

  try {
    const { results: rounds } = await db.prepare(
      `SELECT * FROM rounds WHERE status = 'drawn'
       ORDER BY round_number DESC LIMIT 20`
    ).all();

    return Response.json({ rounds: rounds || [] });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
