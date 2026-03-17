const express = require('express');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 7860;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.exp) return Promise.resolve(hit.val);
  return fn().then(val => { cache.set(key, { val, exp: Date.now() + ttlMs }); return val; });
}

function get(hostname, path, useHttp = false) {
  return new Promise((resolve, reject) => {
    const mod = useHttp ? http : https;
    const isPlay = hostname === '123movienow.cc';
    mod.request({
      hostname, path,
      headers: {
        'User-Agent': UA,
        'Referer': isPlay ? 'https://123movienow.cc/' : 'https://moviebox.ph/',
        'Origin': isPlay ? 'https://123movienow.cc' : 'https://moviebox.ph',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'x-requested-with': 'XMLHttpRequest'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const u = new URL(loc);
        return get(u.hostname, u.pathname + u.search, u.protocol === 'http:').then(resolve).catch(reject);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject).end();
  });
}

function resolveNuxt(arr, idx, seen = new Map()) {
  if (seen.has(idx)) return seen.get(idx);
  const v = arr[idx];
  if (v === null || typeof v !== 'object') { seen.set(idx, v); return v; }
  if (Array.isArray(v)) {
    if (v[0] === 'ShallowReactive' || v[0] === 'Reactive') return resolveNuxt(arr, v[1], seen);
    const r = v.map(i => typeof i === 'number' ? resolveNuxt(arr, i, seen) : i);
    seen.set(idx, r); return r;
  }
  const r = {}; seen.set(idx, r);
  for (const [k, val] of Object.entries(v)) r[k] = typeof val === 'number' ? resolveNuxt(arr, val, seen) : val;
  return r;
}

function mapSubject(s) {
  return {
    slug: s.detailPath,
    subjectId: s.subjectId,
    title: s.title,
    type: s.subjectType === 1 ? 'movie' : 'series',
    releaseDate: s.releaseDate,
    genre: s.genre,
    country: s.countryName,
    imdbRating: parseFloat(s.imdbRatingValue) || null,
    cover: s.cover?.url || null,
    corner: s.corner || null
  };
}

async function getHome() {
  const raw = await get('h5-api.aoneroom.com', '/wefeed-h5api-bff/home');
  const json = JSON.parse(raw);
  if (json.code !== 0) throw new Error(json.message);
  const sections = [];
  for (const op of json.data.operatingList || []) {
    if (op.type === 'SUBJECTS_MOVIE' && op.subjects?.length) {
      sections.push({ title: op.title, items: op.subjects.map(mapSubject) });
    } else if (op.type === 'APPOINTMENT_LIST' && op.subjects?.length) {
      sections.push({
        title: op.title,
        items: op.subjects.map(s => ({ ...mapSubject(s), appointmentDate: s.appointmentDate, bookedCount: s.appointmentCnt }))
      });
    }
  }
  return sections;
}

async function search(keyword) {
  const html = await get('moviebox.ph', `/web/searchResult?keyword=${encodeURIComponent(keyword)}`);
  const m = html.match(/id="__NUXT_DATA__">([\s\S]+?)<\/script>/);
  if (!m) throw new Error('Could not parse search page');
  const arr = JSON.parse(m[1]);
  const resolved = resolveNuxt(arr, 0);
  const keys = Object.keys(resolved?.data || {});
  const items = resolved?.data?.[keys[1]]?.data?.items;
  if (!items) throw new Error('No results found');
  return items.map(item => ({
    slug: item.detailPath,
    subjectId: item.subjectId,
    title: item.title,
    type: item.subjectType === 1 ? 'movie' : 'series',
    releaseDate: item.releaseDate,
    genre: item.genre,
    country: item.countryName,
    imdbRating: item.imdbRatingValue,
    cover: item.cover?.url || null,
    hasResource: item.hasResource,
    detailUrl: `https://moviebox.ph/detail/${item.detailPath}`
  }));
}

async function getDetail(slug) {
  const raw = await get('h5-api.aoneroom.com', `/wefeed-h5api-bff/detail?detailPath=${slug}`);
  const json = JSON.parse(raw);
  if (json.code !== 0) throw new Error(json.message);
  const s = json.data.subject;
  const isMovie = s.subjectType === 1;

  const availableDubs = (s.dubs || []).filter(d => d.type === 0).map(d => ({
    lang: d.lanCode, name: d.lanName, slug: d.detailPath, subjectId: d.subjectId
  }));
  const availableSubs = (s.dubs || []).filter(d => d.type === 1).map(d => ({
    lang: d.lanCode, name: d.lanName, slug: d.detailPath, subjectId: d.subjectId
  }));

  const seasons = (json.data.resource?.seasons || []).map(season => ({
    season: season.se,
    totalEpisodes: season.maxEp,
    resolutions: season.resolutions?.map(r => r.resolution) || [],
    episodes: Array.from({ length: season.maxEp }, (_, i) => ({
      episode: i + 1,
      streamUrl: `/stream?slug=${s.detailPath}&se=${season.se}&ep=${i + 1}`
    }))
  }));

  return {
    subjectId: s.subjectId,
    slug: s.detailPath,
    title: s.title,
    type: isMovie ? 'movie' : 'series',
    description: s.description,
    releaseDate: s.releaseDate,
    duration: s.duration || null,
    genre: s.genre,
    country: s.countryName,
    imdbRating: s.imdbRatingValue,
    imdbRatingCount: s.imdbRatingCount,
    subtitles: s.subtitles ? s.subtitles.split(',').map(x => x.trim()) : [],
    availableDubs,
    availableSubs,
    cover: s.cover?.url || null,
    trailer: s.trailer?.videoAddress?.url || null,
    trailerThumbnail: s.trailer?.cover?.url || null,
    cast: (json.data.stars || []).map(st => ({ name: st.name, character: st.character, avatar: st.avatarUrl })),
    seasons: isMovie ? [] : seasons,
    streamUrl: isMovie ? `/stream?slug=${s.detailPath}` : null
  };
}

async function extractStreams(slug, se, ep, lang, quality) {
  // Fetch detail and play API in parallel
  const [detail, playRaw] = await Promise.all([
    getDetail(slug),
    (() => {
      // We need detail first to resolve lang/dub slug — do a quick pre-fetch for play
      // Will be re-used after detail resolves
      return null;
    })()
  ]);

  const isMovie = detail.type === 'movie';
  const finalSe = isMovie ? (se || '0') : (se || '1');
  const finalEp = ep || '1';

  let streamSlug = detail.slug;
  let streamId = detail.subjectId;
  if (lang && lang !== 'en') {
    const dub = [...detail.availableDubs, ...detail.availableSubs]
      .find(d => d.lang === lang || d.name.toLowerCase().includes(lang.toLowerCase()));
    if (dub) { streamSlug = dub.slug; streamId = dub.subjectId; }
  }

  const playPath = `/wefeed-h5api-bff/subject/play?subjectId=${streamId}&se=${finalSe}&ep=${finalEp}&detailPath=${streamSlug}`;

  // Fetch play + captions in parallel (captions need stream id, so play first then captions)
  const playData = await get('123movienow.cc', playPath, false).catch(() => get('123movienow.cc', playPath, true));
  const playJson = JSON.parse(playData);
  if (playJson.code !== 0) throw new Error(playJson.message || 'Failed to get streams');

  const rawStreams = playJson.data.streams || [];

  // Fetch captions in parallel with nothing else to wait for
  const captionsPromise = rawStreams[0]?.id
    ? get('h5-api.aoneroom.com', `/wefeed-h5api-bff/subject/caption?format=MP4&id=${rawStreams[0].id}&subjectId=${streamId}&detailPath=${streamSlug}`)
        .then(r => JSON.parse(r))
        .then(r => r.code === 0 ? r.data.captions.map(c => ({ lang: c.lan, name: c.lanName, url: c.url })) : [])
        .catch(() => [])
    : Promise.resolve([]);

  const allStreams = rawStreams.map(s => ({
    url: s.url,
    quality: s.resolutions ? `${s.resolutions}p` : 'unknown',
    resolution: parseInt(s.resolutions) || 0,
    format: s.format,
    size: parseInt(s.size) || 0,
    duration: s.duration
  })).sort((a, b) => b.resolution - a.resolution);

  const streams = quality
    ? allStreams.filter(s => s.resolution === parseInt(quality))
    : allStreams;

  const captions = await captionsPromise;

  return {
    title: detail.title,
    type: detail.type,
    season: isMovie ? null : finalSe,
    episode: isMovie ? null : finalEp,
    cover: detail.cover,
    description: detail.description,
    imdbRating: detail.imdbRating,
    cast: detail.cast,
    availableQualities: allStreams.map(s => s.quality),
    availableDubs: detail.availableDubs,
    availableSubs: detail.availableSubs,
    streams,
    captions,
    playerUrl: `https://123movienow.cc/spa/videoPlayPage/movies/${streamSlug}?id=${streamId}&type=/movie/detail&detailSe=${finalSe}&detailEp=${finalEp}&lang=en`
  };
}

app.get('/home', (req, res) => {
  cached('home', 5 * 60 * 1000, getHome)
    .then(sections => res.json({ sections })).catch(err => res.status(500).json({ error: err.message }));
});

app.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });
  cached(`search:${q}`, 10 * 60 * 1000, () => search(q))
    .then(results => res.json({ results })).catch(err => res.status(500).json({ error: err.message }));
});

app.get('/detail', (req, res) => {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'slug is required' });
  cached(`detail:${slug}`, 10 * 60 * 1000, () => getDetail(slug))
    .then(d => res.json(d)).catch(err => res.status(500).json({ error: err.message }));
});

app.get('/stream', (req, res) => {
  const { slug, se, ep, lang, quality } = req.query;
  if (!slug) return res.status(400).json({ error: 'slug is required' });
  const key = `stream:${slug}:${se}:${ep}:${lang}:${quality}`;
  cached(key, 2 * 60 * 1000, () => extractStreams(slug, se, ep, lang, quality))
    .then(r => res.json(r)).catch(err => res.status(500).json({ error: err.message }));
});

app.get('/', (req, res) => res.json({
  name: 'Movie Stream API',
  endpoints: {
    'GET /home': { description: 'Homepage sections (Popular Series, Popular Movie, Anime, etc.)' },
    'GET /search': { params: { q: 'keyword' } },
    'GET /detail': { params: { slug: 'detailPath' } },
    'GET /stream': { params: { slug: 'detailPath', se: 'season (series)', ep: 'episode (series)', lang: 'dub lang code', quality: '360|480|720|1080' } }
  },
  examples: [
    '/search?q=zootopia',
    '/detail?slug=zootopia-SxDV9XZ5kg6',
    '/stream?slug=zootopia-SxDV9XZ5kg6',
    '/stream?slug=zootopia-SxDV9XZ5kg6&quality=720',
    '/stream?slug=the-simpsons-2nXz41q46j9&se=1&ep=1',
    '/stream?slug=the-simpsons-2nXz41q46j9&se=1&ep=1&lang=fr&quality=1080'
  ]
}));

app.listen(PORT, () => console.log(`Stream API on http://localhost:${PORT}`));
