---
title: Movie Stream API
emoji: 🎬
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
---

# Movie Stream API

Base URL: `https://anointedthedeveloper-streamarino.hf.space`

---

## `GET /search`

Search for movies and series.

**Query params:** `q` (required)

**Request:**
```
GET /search?q=zootopia
```

**Response:**
```json
{
  "results": [
    {
      "slug": "zootopia-SxDV9XZ5kg6",
      "subjectId": 12345,
      "title": "Zootopia",
      "type": "movie",
      "releaseDate": "2016-03-04",
      "genre": "Animation, Adventure, Comedy",
      "country": "United States",
      "imdbRating": 8.0,
      "cover": "https://cdn.example.com/cover.jpg",
      "hasResource": true,
      "detailUrl": "https://moviebox.ph/detail/zootopia-SxDV9XZ5kg6"
    }
  ]
}
```

---

## `GET /detail`

Get full metadata, cast, seasons, episodes, and available dubs/subs.

**Query params:** `slug` (required)

**Request:**
```
GET /detail?slug=zootopia-SxDV9XZ5kg6
```

**Response:**
```json
{
  "subjectId": 12345,
  "slug": "zootopia-SxDV9XZ5kg6",
  "title": "Zootopia",
  "type": "movie",
  "description": "...",
  "releaseDate": "2016-03-04",
  "duration": 108,
  "genre": "Animation, Adventure, Comedy",
  "country": "United States",
  "imdbRating": 8.0,
  "imdbRatingCount": 500000,
  "subtitles": ["en", "fr", "es"],
  "cover": "https://cdn.example.com/cover.jpg",
  "trailer": "https://cdn.example.com/trailer.mp4",
  "trailerThumbnail": "https://cdn.example.com/thumb.jpg",
  "cast": [
    { "name": "Ginnifer Goodwin", "character": "Judy Hopps", "avatar": "https://..." }
  ],
  "availableDubs": [
    { "lang": "fr", "name": "French", "slug": "zootopia-fr-XXXX", "subjectId": 12346 }
  ],
  "availableSubs": [
    { "lang": "es", "name": "Spanish", "slug": "zootopia-es-XXXX", "subjectId": 12347 }
  ],
  "seasons": [],
  "streamUrl": "/stream?slug=zootopia-SxDV9XZ5kg6"
}
```

For a **series**, `seasons` is populated and `streamUrl` is null:
```json
{
  "type": "series",
  "streamUrl": null,
  "seasons": [
    {
      "season": 1,
      "totalEpisodes": 22,
      "resolutions": [360, 480, 720, 1080],
      "episodes": [
        { "episode": 1, "streamUrl": "/stream?slug=the-simpsons-2nXz41q46j9&se=1&ep=1" }
      ]
    }
  ]
}
```

---

## `GET /stream`

Get direct video stream URLs for a movie or series episode.

**Query params:**

| Param | Required | Description |
|-------|----------|-------------|
| `slug` | ✅ | From search or detail |
| `se` | series only | Season number |
| `ep` | series only | Episode number |
| `lang` | ❌ | Dub language code e.g. `fr`, `ru`, `ptbr` |
| `quality` | ❌ | Filter to one quality: `360`, `480`, `720`, `1080` |

**Requests:**
```
GET /stream?slug=zootopia-SxDV9XZ5kg6
GET /stream?slug=zootopia-SxDV9XZ5kg6&quality=720
GET /stream?slug=the-simpsons-2nXz41q46j9&se=1&ep=1
GET /stream?slug=the-simpsons-2nXz41q46j9&se=1&ep=1&lang=fr&quality=1080
```

**Response:**
```json
{
  "title": "Zootopia",
  "type": "movie",
  "season": null,
  "episode": null,
  "cover": "https://cdn.example.com/cover.jpg",
  "description": "...",
  "imdbRating": 8.0,
  "cast": [
    { "name": "Ginnifer Goodwin", "character": "Judy Hopps", "avatar": "https://..." }
  ],
  "availableQualities": ["1080p", "720p", "480p", "360p"],
  "availableDubs": [
    { "lang": "fr", "name": "French", "slug": "zootopia-fr-XXXX", "subjectId": 12346 }
  ],
  "availableSubs": [
    { "lang": "es", "name": "Spanish", "slug": "zootopia-es-XXXX", "subjectId": 12347 }
  ],
  "streams": [
    {
      "url": "https://cdn.example.com/video_1080p.mp4",
      "quality": "1080p",
      "resolution": 1080,
      "format": "MP4",
      "size": 2147483648,
      "duration": 6480
    }
  ],
  "captions": [
    { "lang": "en", "name": "English", "url": "https://cdn.example.com/sub_en.srt" }
  ],
  "playerUrl": "https://123movienow.cc/spa/videoPlayPage/movies/zootopia-SxDV9XZ5kg6?..."
}
```

---

## Frontend Usage Pattern

```js
const BASE = 'https://anointedthedeveloper-streamarino.hf.space';

// 1. Search
const { results } = await fetch(`${BASE}/search?q=zootopia`).then(r => r.json());
const { slug } = results[0];

// 2. Get detail (for seasons/episodes list)
const detail = await fetch(`${BASE}/detail?slug=${slug}`).then(r => r.json());

// 3. Get streams (movie)
const data = await fetch(`${BASE}/stream?slug=${slug}`).then(r => r.json());
const videoUrl = data.streams[0].url;

// 3b. Get streams (series episode)
const data = await fetch(`${BASE}/stream?slug=${slug}&se=1&ep=1`).then(r => r.json());

// 3c. Get streams (dubbed)
const data = await fetch(`${BASE}/stream?slug=${slug}&lang=fr`).then(r => r.json());
```

---

## Error Response

All errors return:
```json
{ "error": "description of what went wrong" }
```
