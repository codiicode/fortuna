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

    // Filter new (unprocessed, non-failed)
    const newSigs = signatures.filter(s => !s.err && !existingSet.has(s.signature));

    if (newSigs.length === 0) {
      return Response.json({ processed: 0 });
    }

    let totalProcessed = 0;

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
        if (availableCount <= 0) continue;
        const actualTicketCount = Math.min(ticketCount, availableCount);

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

        // Update jackpot (90% jackpot, 7.5% buyback & burn, 2.5% protocol)
        const addedToJackpot = actualTicketCount * TICKET_PRICE_SOL * 0.9;
        await db.prepare(
          `UPDATE rounds SET jackpot_amount = jackpot_amount + ? WHERE id = ?`
        ).bind(addedToJackpot, round.id).run();

        totalProcessed += actualTicketCount;

      } catch (txErr) {
        // Skip individual tx on failure, continue with next
        console.error('Failed to process tx:', sig.signature, txErr.message);
      }
    }

    return Response.json({ processed: totalProcessed });

  } catch (err) {
    return Response.json({ processed: 0, error: err.message }, { status: 500 });
  }
}
