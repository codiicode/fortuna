// Proxy för Solana RPC — håller API-nyckeln på backend
// Tillåter bara specifika metoder

const ALLOWED_METHODS = ['getLatestBlockhash', 'sendRawTransaction'];

export async function onRequestPost(context) {
  const rpcUrl = context.env.SOLANA_RPC;

  if (!rpcUrl) {
    return Response.json({ error: 'RPC not configured' }, { status: 500 });
  }

  try {
    const body = await context.request.json();

    // Tillåt bara säkra metoder
    if (!ALLOWED_METHODS.includes(body.method)) {
      return Response.json({ error: 'Method not allowed' }, { status: 403 });
    }

    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
