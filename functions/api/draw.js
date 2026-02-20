// === BASE58 ===
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58decode(str) {
  const bytes = [];
  for (const c of str) {
    const idx = B58.indexOf(c);
    if (idx < 0) throw new Error('Invalid base58');
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

// === SEND SOL PAYOUT ===
async function sendPayout(rpcUrl, treasurySecretKeyB58, winnerAddr, amountSol) {
  const keypairBytes = b58decode(treasurySecretKeyB58); // 64 bytes (32 seed + 32 pubkey)
  const seed = keypairBytes.slice(0, 32);
  const fromPubkey = keypairBytes.slice(32, 64);
  const toPubkey = b58decode(winnerAddr);
  const systemProgramId = new Uint8Array(32); // 11111111111111111111111111111111

  // Get recent blockhash
  const bhResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'finalized' }]
    })
  });
  const bhResult = await bhResp.json();
  const recentBlockhash = b58decode(bhResult.result.value.blockhash);

  // Transfer instruction data: u32 LE (2 = Transfer) + u64 LE (lamports)
  const lamports = BigInt(Math.round(amountSol * 1e9));
  const ixData = new Uint8Array(12);
  const view = new DataView(ixData.buffer);
  view.setUint32(0, 2, true);
  view.setUint32(4, Number(lamports & 0xFFFFFFFFn), true);
  view.setUint32(8, Number((lamports >> 32n) & 0xFFFFFFFFn), true);

  // Build message (150 bytes)
  // Header(3) + numKeys(1) + keys(96) + blockhash(32) + numIx(1) + ix(17)
  const message = new Uint8Array(150);
  let o = 0;
  message[o++] = 1; // numRequiredSignatures
  message[o++] = 0; // numReadonlySignedAccounts
  message[o++] = 1; // numReadonlyUnsignedAccounts
  message[o++] = 3; // numAccountKeys
  message.set(fromPubkey, o); o += 32;
  message.set(toPubkey, o); o += 32;
  message.set(systemProgramId, o); o += 32;
  message.set(recentBlockhash, o); o += 32;
  message[o++] = 1; // numInstructions
  message[o++] = 2; // programIdIndex (system program)
  message[o++] = 2; // numAccountIndices
  message[o++] = 0; // from (signer, writable)
  message[o++] = 1; // to (writable)
  message[o++] = 12; // data length
  message.set(ixData, o);

  // Sign with Ed25519
  const cryptoKey = await crypto.subtle.importKey(
    'raw', seed, { name: 'Ed25519' }, false, ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', cryptoKey, message));

  // Build full transaction
  const tx = new Uint8Array(1 + 64 + message.length);
  tx[0] = 1; // numSignatures
  tx.set(sig, 1);
  tx.set(message, 65);

  // Send
  let binary = '';
  for (let i = 0; i < tx.length; i++) binary += String.fromCharCode(tx[i]);

  const sendResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'sendRawTransaction',
      params: [btoa(binary), { encoding: 'base64', skipPreflight: false }]
    })
  });

  const sendResult = await sendResp.json();
  if (sendResult.error) throw new Error(sendResult.error.message);
  return sendResult.result; // tx signature
}

// === DRAW ===
export async function onRequestPost(context) {
  const db = context.env.DB;

  try {
    const { secret } = await context.request.json();
    if (secret !== context.env.DRAW_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Process any pending deposits first
    try {
      await fetch(new URL('/api/process-deposits', context.request.url), { method: 'POST' });
    } catch (e) { /* non-critical */ }

    const round = await db.prepare(
      `SELECT * FROM rounds WHERE status = 'active' ORDER BY round_number DESC LIMIT 1`
    ).first();

    if (!round) {
      return Response.json({ error: 'No active round' }, { status: 400 });
    }

    // Get latest slot + blockhash
    const rpcUrl = context.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

    const slotResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' })
    });
    const slot = (await slotResp.json()).result;

    const blockResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getBlock',
        params: [slot, { encoding: 'json', transactionDetails: 'none', rewards: false }]
      })
    });
    const blockhash = (await blockResp.json()).result?.blockhash;

    if (!blockhash) {
      return Response.json({ error: 'Failed to get blockhash' }, { status: 500 });
    }

    // Winning number: SHA256(blockhash + roundId) mod 10000
    const encoder = new TextEncoder();
    const data = encoder.encode(blockhash + ':' + round.id);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    const winningNumber = parseInt(hashHex.slice(0, 8), 16) % 10000;

    // Find winner (exact 4-digit match)
    const { results: winners } = await db.prepare(
      `SELECT DISTINCT wallet_address FROM tickets
       WHERE round_id = ? AND ticket_number = ?`
    ).bind(round.id, winningNumber).all();

    const winnerWallet = winners && winners.length > 0 ? winners[0].wallet_address : null;

    // Close the round
    await db.prepare(
      `UPDATE rounds SET
        status = 'drawn',
        winning_number = ?,
        winner_wallet = ?,
        draw_blockhash = ?,
        draw_slot = ?
       WHERE id = ?`
    ).bind(winningNumber, winnerWallet, blockhash, slot, round.id).run();

    // Auto-payout to winner
    let payoutTx = null;
    if (winnerWallet && round.jackpot_amount > 0 && context.env.TREASURY_PRIVATE_KEY) {
      try {
        payoutTx = await sendPayout(
          rpcUrl,
          context.env.TREASURY_PRIVATE_KEY,
          winnerWallet,
          round.jackpot_amount
        );
        console.log('Payout sent:', payoutTx);
      } catch (payErr) {
        console.error('Payout failed:', payErr.message);
        // Draw already completed — log error, manual payout needed
      }
    }

    // New round — jackpot rolls over if no winner
    const durationMinutes = parseInt(context.env.ROUND_DURATION_MINUTES) || 1440;
    const nextDrawTime = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const nextJackpot = winnerWallet ? 0 : round.jackpot_amount;
    const nextTicketPrice = parseFloat(context.env.TICKET_PRICE) || 0.03;
    await db.prepare(
      `INSERT INTO rounds (round_number, jackpot_amount, status, draw_time, ticket_price)
       VALUES (?, ?, 'active', ?, ?)`
    ).bind(round.round_number + 1, nextJackpot, nextDrawTime, nextTicketPrice).run();

    return Response.json({
      success: true,
      winning_number: winningNumber,
      winner: winnerWallet,
      jackpot: round.jackpot_amount,
      payout_tx: payoutTx,
      new_round: round.round_number + 1,
      blockhash,
      slot
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
