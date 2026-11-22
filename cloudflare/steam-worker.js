// Relais Steam pour GameTime (Cloudflare Worker).
// Secret à définir dans le Worker : STEAM_KEY (clé Steam Web API).
const ALLOWED = ['https://fascini.github.io', 'http://localhost:8000'];

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Vary': 'Origin'
    };
    const json = (o, s = 200) => new Response(JSON.stringify(o), {
      status: s, headers: { ...cors, 'Content-Type': 'application/json' }
    });
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    }
    if (!env.STEAM_KEY) return json({ error: 'STEAM_KEY manquante sur le Worker' }, 500);

    const u = new URL(req.url);
    const q = u.searchParams;
    const steamid = q.get('steamid') || '';
    const call = async (path, params) => {
      const r = await fetch('https://api.steampowered.com' + path + '?' +
        new URLSearchParams({ key: env.STEAM_KEY, format: 'json', ...params }));
      const t = await r.text();
      try { return { status: r.status, data: JSON.parse(t) }; }
      catch { return { status: r.status, data: null }; }
    };
    const needId = () => !/^\d{17}$/.test(steamid);

    try {
      switch (u.pathname) {
        case '/resolve': {
          const vanity = q.get('vanity') || '';
          if (!/^[A-Za-z0-9_-]{2,32}$/.test(vanity)) return json({ error: 'Pseudo invalide' }, 400);
          const { data } = await call('/ISteamUser/ResolveVanityURL/v1/', { vanity });
          if (!data || data.response.success !== 1) return json({ error: 'Profil introuvable' }, 404);
          return json({ steamid: data.response.steamid });
        }
        case '/summary': {
          if (needId()) return json({ error: 'SteamID invalide' }, 400);
          const { data } = await call('/ISteamUser/GetPlayerSummaries/v2/', { steamids: steamid });
          const p = data && data.response.players[0];
          if (!p) return json({ error: 'Profil introuvable' }, 404);
          return json({ personaname: p.personaname, avatarfull: p.avatarfull, visible: p.communityvisibilitystate === 3 });
        }
        case '/owned': {
          if (needId()) return json({ error: 'SteamID invalide' }, 400);
          const { data } = await call('/IPlayerService/GetOwnedGames/v1/', {
            steamid, include_appinfo: '1', include_played_free_games: '1'
          });
          const r = data && data.response;
          if (!r || !r.games) return json({ games: [], private: true });
          return json({
            games: r.games.map(g => ({ appid: g.appid, name: g.name, minutes: g.playtime_forever || 0 }))
          });
        }
        case '/achievements': {
          if (needId()) return json({ error: 'SteamID invalide' }, 400);
          const appid = q.get('appid') || '';
          if (!/^\d{1,9}$/.test(appid)) return json({ error: 'appid invalide' }, 400);
          const { data } = await call('/ISteamUserStats/GetPlayerAchievements/v1/', { steamid, appid, l: 'french' });
          const ps = data && data.playerstats;
          if (!ps || ps.success === false || !ps.achievements) {
            return json({ error: (ps && ps.error) || 'Aucun succès disponible pour ce jeu' });
          }
          return json({
            achievements: ps.achievements.map(a => ({
              name: a.name || a.apiname, achieved: a.achieved, time: a.unlocktime
            }))
          });
        }
        default:
          return json({ error: 'Route inconnue' }, 404);
      }
    } catch (e) {
      return json({ error: 'Erreur du relais' }, 502);
    }
  }
};
