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

async function sendRefund(rpcUrl, treasurySecretKeyB58, toAddress, amountSol) {
  const keypairBytes = b58decode(treasurySecretKeyB58);
  const seed = keypairBytes.slice(0, 32);
  const fromPubkey = keypairBytes.slice(32, 64);
  const toPubkey = b58decode(toAddress);
  const systemProgramId = new Uint8Array(32);

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

  const lamports = BigInt(Math.round(amountSol * 1e9));
  const ixData = new Uint8Array(12);
  const view = new DataView(ixData.buffer);
  view.setUint32(0, 2, true);
  view.setUint32(4, Number(lamports & 0xFFFFFFFFn), true);
  view.setUint32(8, Number((lamports >> 32n) & 0xFFFFFFFFn), true);

  const message = new Uint8Array(150);
  let o = 0;
  message[o++] = 1;
  message[o++] = 0;
  message[o++] = 1;
  message[o++] = 3;
  message.set(fromPubkey, o); o += 32;
  message.set(toPubkey, o); o += 32;
  message.set(systemProgramId, o); o += 32;
  message.set(recentBlockhash, o); o += 32;
  message[o++] = 1;
  message[o++] = 2;
  message[o++] = 2;
  message[o++] = 0;
  message[o++] = 1;
  message[o++] = 12;
  message.set(ixData, o);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', seed, { name: 'Ed25519' }, false, ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', cryptoKey, message));

  const tx = new Uint8Array(1 + 64 + message.length);
  tx[0] = 1;
  tx.set(sig, 1);
  tx.set(message, 65);

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
  return sendResult.result;
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const TREASURY = context.env.TREASURY_WALLET;
  const rpcUrl = context.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

  try {
    // Get active round
    const round = await db.prepare(
      `SELECT * FROM rounds WHERE status = 'active' ORDER BY round_number DESC LIMIT 1`
    ).first();

    if (!round) {
      return Response.json({ processed: 0, error: 'No active round' });
    }

    const TICKET_PRICE_SOL = round.ticket_price || 0.1;

    // Get recent transactions to treasury
    const sigsResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getSignaturesForAddress',
        params: [TREASURY, { limit: 50 }]
      })
    });
    const sigsData = await sigsResp.json();
    const signatures = sigsData.result || [];

    if (signatures.length === 0) {
      return Response.json({ processed: 0 });
    }

    // Check which signatures are already processed
    const sigList = signatures.map(s => s.signature);
    const placeholders = sigList.map(() => '?').join(',');
    const { results: existing } = await db.prepare(
      `SELECT DISTINCT tx_signature FROM tickets WHERE tx_signature IN (${placeholders})`
    ).bind(...sigList).all();
    const existingSet = new Set((existing || []).map(r => r.tx_signature));

    // Also check refunded signatures
    const { results: refunded } = await db.prepare(
      `SELECT DISTINCT tx_signature FROM refunds WHERE tx_signature IN (${placeholders})`
    ).bind(...sigList).all();
    const refundedSet = new Set((refunded || []).map(r => r.tx_signature));

    // Filter new (unprocessed, non-failed, non-refunded)
    const newSigs = signatures.filter(s => !s.err && !existingSet.has(s.signature) && !refundedSet.has(s.signature));

    if (newSigs.length === 0) {
      return Response.json({ processed: 0 });
    }

    let totalProcessed = 0;
    let totalRefunded = 0;

    // Get all ticket numbers already used in this round
    const { results: existingTickets } = await db.prepare(
      `SELECT ticket_number FROM tickets WHERE round_id = ?`
    ).bind(round.id).all();
    const usedNumbers = new Set((existingTickets || []).map(t => t.ticket_number));

    // Process each new transaction
    for (const sig of newSigs) {
      try {
        const txResp = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getTransaction',
            params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
          })
        });
        const txData = await txResp.json();
        const tx = txData.result;

        if (!tx || tx.meta?.err) continue;

        // Find SOL transfer to treasury
        const instructions = tx.transaction?.message?.instructions || [];
        let senderWallet = null;
        let amountSol = 0;

        for (const ix of instructions) {
          if (ix.parsed?.type === 'transfer' && ix.program === 'system') {
            const info = ix.parsed.info;
            if (info.destination === TREASURY) {
              senderWallet = info.source;
              amountSol = info.lamports / 1e9;
              break;
            }
          }
        }

        // Check innerInstructions as well
        if (!senderWallet && tx.meta?.innerInstructions) {
          for (const inner of tx.meta.innerInstructions) {
            for (const ix of inner.instructions) {
              if (ix.parsed?.type === 'transfer' && ix.program === 'system') {
                const info = ix.parsed.info;
                if (info.destination === TREASURY) {
                  senderWallet = info.source;
                  amountSol = info.lamports / 1e9;
                  break;
                }
              }
            }
            if (senderWallet) break;
          }
        }

        if (!senderWallet || amountSol < TICKET_PRICE_SOL) continue;

        // Calculate ticket count: floor(amount / price)
        const ticketCount = Math.floor(amountSol / TICKET_PRICE_SOL);
        if (ticketCount <= 0) continue;

        // Check available numbers (max 10,000 unique tickets per round)
        const availableCount = 10000 - usedNumbers.size;

        // Round is full — refund the entire deposit
        if (availableCount <= 0) {
          if (context.env.TREASURY_PRIVATE_KEY) {
            try {
              const refundTx = await sendRefund(rpcUrl, context.env.TREASURY_PRIVATE_KEY, senderWallet, amountSol);
              await db.prepare(
                `INSERT INTO refunds (wallet_address, amount_sol, tx_signature, refund_tx, reason) VALUES (?, ?, ?, ?, ?)`
              ).bind(senderWallet, amountSol, sig.signature, refundTx, 'round_full').run();
              totalRefunded++;
              console.log('Refund sent:', refundTx, 'to', senderWallet);
            } catch (refundErr) {
              console.error('Refund failed:', refundErr.message);
            }
          }
          continue;
        }

        const actualTicketCount = Math.min(ticketCount, availableCount);
        const unusedSol = (ticketCount - actualTicketCount) * TICKET_PRICE_SOL;

        // Build pool of available numbers and shuffle
        const availableNumbers = [];
        for (let n = 0; n < 10000; n++) {
          if (!usedNumbers.has(n)) availableNumbers.push(n);
        }
        for (let i = availableNumbers.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [availableNumbers[i], availableNumbers[j]] = [availableNumbers[j], availableNumbers[i]];
        }
        const pickedNumbers = availableNumbers.slice(0, actualTicketCount);

        // Generate tickets with unique numbers
        const stmt = db.prepare(
          `INSERT INTO tickets (round_id, wallet_address, ticket_number, tx_signature)
           VALUES (?, ?, ?, ?)`
        );

        const batch = [];
        for (const num of pickedNumbers) {
          batch.push(stmt.bind(round.id, senderWallet, num, sig.signature));
          usedNumbers.add(num);
        }

        await db.batch(batch);

        // Update jackpot (full amount displayed, 90% paid to winner on draw)
        const addedToJackpot = actualTicketCount * TICKET_PRICE_SOL;
        await db.prepare(
          `UPDATE rounds SET jackpot_amount = jackpot_amount + ? WHERE id = ?`
        ).bind(addedToJackpot, round.id).run();

        totalProcessed += actualTicketCount;

        // Refund unused SOL (partial — agent sent more than available slots)
        if (unusedSol >= TICKET_PRICE_SOL && context.env.TREASURY_PRIVATE_KEY) {
          try {
            const refundTx = await sendRefund(rpcUrl, context.env.TREASURY_PRIVATE_KEY, senderWallet, unusedSol);
            await db.prepare(
              `INSERT INTO refunds (wallet_address, amount_sol, tx_signature, refund_tx, reason) VALUES (?, ?, ?, ?, ?)`
            ).bind(senderWallet, unusedSol, sig.signature, refundTx, 'partial_overflow').run();
            totalRefunded++;
            console.log('Partial refund sent:', refundTx, unusedSol, 'SOL to', senderWallet);
          } catch (refundErr) {
            console.error('Partial refund failed:', refundErr.message);
          }
        }

      } catch (txErr) {
        // Skip individual tx on failure, continue with next
        console.error('Failed to process tx:', sig.signature, txErr.message);
      }
    }

    return Response.json({ processed: totalProcessed, refunded: totalRefunded });

  } catch (err) {
    return Response.json({ processed: 0, error: err.message }, { status: 500 });
  }
}
