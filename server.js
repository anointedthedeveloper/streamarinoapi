const express = require('express');
const https = require('https');
const { chromium } = require('c:\\Users\\Admin\\.agents\\skills\\playwright\\node_modules\\playwright');

const app = express();
const PORT = 3000;

const BLOCKED = ['google-analytics', 'firebase', 'hisavana', 'doubleclick', 'googlesyndication', 'adservice', 'analytics', 'firebaselogging', 'firebaseinstallations'];

let browser;
const streamPages = [];
const MAX_PAGES = 3;
const queue = [];
let activeJobs = 0;

async function initBrowser() {
  browser = await chromium.launch({ headless: true });
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await browser.newPage();
    await page.route('**/*', route => {
      if (BLOCKED.some(b => route.request().url().includes(b))) return route.abort();
      route.continue();
    });
    streamPages.push({ page, busy: false });
  }
  console.log(`Browser ready with ${MAX_PAGES} stream pages`);
}

function getFreePage() {
  return new Promise(resolve => {
    const slot = streamPages.find(p => !p.busy);
    if (slot) { slot.busy = true; return resolve(slot); }
    queue.push(resolve);
  });
}

function releasePage(slot) {
  slot.busy = false;
  if (queue.length > 0) {
    const next = queue.shift();
    slot.busy = true;
    next(slot);
  }
}

// Plain HTTPS GET
function httpGet(hostname, path, reqHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://moviebox.ph/',
      ...reqHeaders
    };
    https.request({ hostname, path, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject).end();
  });
}

// Parse __NUXT_DATA__ array into resolved objects
function resolveNuxt(arr, idx, visited = new Map()) {
  if (visited.has(idx)) return visited.get(idx);
  const val = arr[idx];
  if (val === null || typeof val !== 'object') { visited.set(idx, val); return val; }
  if (Array.isArray(val)) {
    if (val[0] === 'ShallowReactive' || val[0] === 'Reactive') return resolveNuxt(arr, val[1], visited);
    const result = val.map(i => (typeof i === 'number' ? resolveNuxt(arr, i, visited) : i));
    visited.set(idx, result);
    return result;
  }
  const result = {};
  visited.set(idx, result);
  for (const [k, v] of Object.entries(val)) {
    result[k] = typeof v === 'number' ? resolveNuxt(arr, v, visited) : v;
  }
  return result;
}

// Search via SSR HTML — no Playwright, instant
async function search(keyword) {
  const html = await httpGet('moviebox.ph', `/web/searchResult?keyword=${encodeURIComponent(keyword)}`, { 'Accept': 'text/html' });
  const match = html.match(/id="__NUXT_DATA__">([\s\S]+?)<\/script>/);
  if (!match) throw new Error('Could not find NUXT data');

  const arr = JSON.parse(match[1]);
  const resolved = resolveNuxt(arr, 0);
  // Second key in data holds search results (first key is SEO/TDK metadata)
  const dataKeys = Object.keys(resolved?.data || {});
  const searchKey = dataKeys[1];
  const items = resolved?.data?.[searchKey]?.data?.items;
  if (!items) throw new Error('No search results found');

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
    thumbnail: item.stills?.[0]?.url || item.cover?.url || null,
    hasResource: item.hasResource,
    detailUrl: `https://moviebox.ph/detail/${item.detailPath}`
  }));
}

// Full detail from h5-api
async function getDetail(slug) {
  const raw = await httpGet('h5-api.aoneroom.com', `/wefeed-h5api-bff/detail?detailPath=${slug}`);
  const json = JSON.parse(raw);
  if (json.code !== 0) throw new Error(json.message);
  const s = json.data.subject;
  const seasons = (json.data.resource?.seasons || []).map(season => ({
    season: season.se,
    totalEpisodes: season.maxEp,
    resolutions: season.resolutions,
    episodes: Array.from({ length: season.maxEp }, (_, i) => ({
      episode: i + 1,
      streamUrl: `/stream?slug=${s.detailPath}&se=${season.se}&ep=${i + 1}`
    }))
  }));

  return {
    subjectId: s.subjectId,
    slug: s.detailPath,
    title: s.title,
    type: s.subjectType === 1 ? 'movie' : 'series',
    description: s.description,
    releaseDate: s.releaseDate,
    genre: s.genre,
    country: s.countryName,
    imdbRating: s.imdbRatingValue,
    imdbRatingCount: s.imdbRatingCount,
    subtitles: s.subtitles ? s.subtitles.split(',') : [],
    availableDubs: (s.dubs || []).filter(d => d.type === 0).map(d => ({ lang: d.lanCode, name: d.lanName, slug: d.detailPath, subjectId: d.subjectId })),
    availableSubs: (s.dubs || []).filter(d => d.type === 1).map(d => ({ lang: d.lanCode, name: d.lanName, slug: d.detailPath, subjectId: d.subjectId })),
    dubs: s.dubs || [],
    cover: s.cover?.url || null,
    trailer: s.trailer?.videoAddress?.url || null,
    trailerThumbnail: s.trailer?.cover?.url || null,
    cast: (json.data.stars || []).map(st => ({
      name: st.name,
      character: st.character,
      avatar: st.avatarUrl
    })),
    seasons,
    streamUrl: s.subjectType === 1 ? `/stream?slug=${s.detailPath}` : null
  };
}

// Extract stream URLs using persistent Playwright page
async function extractStreams(slug, se, ep, lang) {
  const detail = await getDetail(slug);

  // For movies: use se=0&ep=1 if not specified
  let finalSe = se;
  let finalEp = ep;
  if (detail.type === 'movie') {
    finalSe = se || '0';
    finalEp = ep || '1';
  }

  // If lang requested, find matching dub slug
  let streamSlug = detail.slug;
  let streamId = detail.subjectId;
  if (lang && lang !== 'en') {
    const dub = detail.dubs.find(d => d.lanCode === lang || d.lanName.toLowerCase().includes(lang.toLowerCase()));
    if (dub) { streamSlug = dub.detailPath; streamId = dub.subjectId; }
  }

  const playerUrl = `https://123movienow.cc/spa/videoPlayPage/movies/${streamSlug}?id=${streamId}&type=/movie/detail&detailSe=${finalSe}&detailEp=${finalEp}&lang=en`;

  const slot = await getFreePage();
  const seen = new Set();
  const streams = [];

  const handler = request => {
    const url = request.url();
    if ((url.includes('.m3u8') || url.includes('.mp4')) && !seen.has(url)) {
      seen.add(url);
      streams.push({ url, headers: request.headers() });
    }
  };

  slot.page.on('request', handler);
  try {
    await slot.page.goto(playerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try {
      const playBtn = slot.page.locator('.vjs-big-play-button').first();
      await playBtn.waitFor({ timeout: 5000 });
      await playBtn.click();
    } catch {}

    await new Promise(resolve => {
      const interval = setInterval(() => {
        if (streams.length > 0) { clearInterval(interval); clearTimeout(timer); resolve(); }
      }, 300);
      const timer = setTimeout(() => { clearInterval(interval); resolve(); }, 20000);
    });
  } finally {
    slot.page.off('request', handler);
    releasePage(slot);
  }

  return {
    title: detail.title,
    type: detail.type,
    season: finalSe || null,
    episode: finalEp || null,
    playerUrl,
    streams
  };
}

// GET /search?q=zootopia
app.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });
  search(q)
    .then(results => res.json({ results }))
    .catch(err => res.status(500).json({ error: err.message }));
});

// GET /detail?slug=zootopia-SxDV9XZ5kg6
app.get('/detail', (req, res) => {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'slug is required' });
  getDetail(slug)
    .then(detail => res.json(detail))
    .catch(err => res.status(500).json({ error: err.message }));
});

// GET /stream?slug=zootopia-SxDV9XZ5kg6
// GET /stream?slug=nesting-8urWu5BPho7&se=1&ep=3
// GET /stream?slug=the-simpsons-2nXz41q46j9&se=1&ep=1&lang=fr  (dub by lang code)
app.get('/stream', (req, res) => {
  const { slug, se, ep, lang } = req.query;
  if (!slug) return res.status(400).json({ error: 'slug is required' });
  extractStreams(slug, se, ep, lang)
    .then(result => res.json(result))
    .catch(err => res.status(500).json({ error: err.message }));
});

initBrowser().then(() => {
  app.listen(PORT, () => console.log(`Stream API running on http://localhost:${PORT}`));
});
