import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDateKey } from './lib/betexplorer.js';
import { getSyncedFixtures } from './lib/fixtures.js';
import { getMatchDetails, getPrematchOdds, parseMatchUrl } from './lib/match.js';
import { getStatshubMatch, statsHubStatus } from './lib/statshub.js';
import { getSoccerwayMatch } from './lib/soccerway.js';
import { fetchImage } from './lib/statshubHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const IMAGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IMAGE_REFERERS = {
  'www.betexplorer.com': 'https://www.betexplorer.com/',
  'cci.betexplorer.com': 'https://www.betexplorer.com/',
  'images.statshub.com': 'https://www.statshub.com/',
};
const ALLOWED_IMAGE_HOSTS = new Set(Object.keys(IMAGE_REFERERS));
const imageCache = new Map();
const MAX_IMAGE_CACHE = 600;

const app = express();
app.disable('x-powered-by');

app.get('/api/fixtures', async (req, res) => {
  const date = String(req.query.date || '');
  if (!parseDateKey(date)) {
    res.status(400).json({ error: 'Provide a valid date in YYYY-MM-DD format.' });
    return;
  }

  try {
    const data = await getSyncedFixtures(date);
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (error) {
    console.error(`[fixtures] ${date}: ${error.message}`);
    res.status(502).json({
      error: 'Could not load fixtures from BetExplorer. Please try again in a moment.',
    });
  }
});

app.get('/api/match', async (req, res) => {
  const url = String(req.query.url || '');
  const market = String(req.query.market || '1x2');
  const statshubId = Number(req.query.sh || 0);

  try {
    // Soccerway uses the same Livesport match code as BetExplorer's URL id.
    const soccerwayId = parseMatchUrl(url)?.id || null;
    const [betexplorer, statshub, prematch, soccerway] = await Promise.all([
      getMatchDetails(url, market),
      statshubId > 0
        ? getStatshubMatch(statshubId).catch((error) => {
            console.error(`[match:statshub] ${statshubId}: ${error.message}`);
            return null;
          })
        : Promise.resolve(null),
      getPrematchOdds(url).catch((error) => {
        console.error(`[match:prematch] ${url}: ${error.message}`);
        return null;
      }),
      soccerwayId
        ? getSoccerwayMatch(soccerwayId).catch((error) => {
            console.error(`[match:soccerway] ${soccerwayId}: ${error.message}`);
            return null;
          })
        : Promise.resolve(null),
    ]);

    res.set('Cache-Control', 'no-store');
    res.json({
      ...betexplorer,
      prematch,
      statshub,
      soccerway,
      statshubStatus: await statsHubStatus(),
    });
  } catch (error) {
    const status = error.statusCode === 400 ? 400 : 502;
    console.error(`[match] ${url}: ${error.message}`);
    res.status(status).json({
      error:
        status === 400
          ? error.message
          : 'Could not load match details from BetExplorer. Please try again in a moment.',
    });
  }
});

app.get('/api/img', async (req, res) => {
  let target;
  try {
    target = new URL(String(req.query.url || ''));
  } catch {
    res.status(400).json({ error: 'Invalid image URL.' });
    return;
  }

  if (target.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(target.hostname)) {
    res.status(403).json({ error: 'Image host is not allowed.' });
    return;
  }

  const key = target.href;
  const cached = imageCache.get(key);
  if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(cached.buffer);
    return;
  }

  if (target.hostname === 'images.statshub.com') {
    const image = await fetchImage(target.href).catch(() => null);
    if (!image) {
      res.status(404).end();
      return;
    }
    imageCache.set(key, {
      buffer: image.buffer,
      contentType: image.contentType,
      timestamp: Date.now(),
    });
    if (imageCache.size > MAX_IMAGE_CACHE) {
      imageCache.delete(imageCache.keys().next().value);
    }
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(image.buffer);
    return;
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': IMAGE_USER_AGENT,
        Referer: IMAGE_REFERERS[target.hostname] || 'https://www.betexplorer.com/',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });

    if (!upstream.ok) {
      res.status(404).end();
      return;
    }

    const finalUrl = new URL(upstream.url);
    if (!ALLOWED_IMAGE_HOSTS.has(finalUrl.hostname)) {
      res.status(403).end();
      return;
    }

    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim();
    const length = Number(upstream.headers.get('content-length') || 0);
    if (!contentType.startsWith('image/') || length > 2 * 1024 * 1024) {
      res.status(415).end();
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > 2 * 1024 * 1024) {
      res.status(413).end();
      return;
    }

    imageCache.set(key, { buffer, contentType, timestamp: Date.now() });
    if (imageCache.size > MAX_IMAGE_CACHE) {
      const oldestKey = imageCache.keys().next().value;
      imageCache.delete(oldestKey);
    }

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (error) {
    console.error(`[img] ${key}: ${error.message}`);
    res.status(502).end();
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));

app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Football fixtures app listening on http://0.0.0.0:${PORT}`);
});
