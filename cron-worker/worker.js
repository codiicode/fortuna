// Runs every minute — processes deposits + checks if round has expired → draw

export default {
  async scheduled(event, env) {
    try {
      // Process new deposits first
      await fetch(env.SITE_URL + '/api/process-deposits', { method: 'POST' });

      // Get active round
      const roundResp = await fetch(env.SITE_URL + '/api/current-round');
      const round = await roundResp.json();

      if (!round.draw_time) return;

      // Check if draw_time has passed
      const drawTime = new Date(round.draw_time + 'Z');
      const now = new Date();

      if (now < drawTime) return;

      // Execute draw
      const resp = await fetch(env.SITE_URL + '/api/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.DRAW_SECRET })
      });

      const result = await resp.json();
      console.log('Draw result:', JSON.stringify(result));
    } catch (err) {
      console.error('Cron error:', err.message);
    }
  }
};
