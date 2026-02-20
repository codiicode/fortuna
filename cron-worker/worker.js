// Kör varje minut — processar deposits + kollar om runda gått ut → draw

export default {
  async scheduled(event, env) {
    try {
      // Processa nya deposits först
      await fetch(env.SITE_URL + '/api/process-deposits', { method: 'POST' });

      // Hämta aktiv runda
      const roundResp = await fetch(env.SITE_URL + '/api/current-round');
      const round = await roundResp.json();

      if (!round.draw_time) return;

      // Kolla om draw_time har passerat
      const drawTime = new Date(round.draw_time + 'Z');
      const now = new Date();

      if (now < drawTime) return;

      // Kör draw
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
