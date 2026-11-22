import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'statshub_fetch.py');

const cache = new Map();
const MAX_CACHE_ENTRIES = 160;
const MAX_BUFFER = 64 * 1024 * 1024;
const SPAWN_TIMEOUT = 90 * 1000;

let pythonPromise = null;

function pythonCandidates() {
  const candidates = [];
  if (process.env.STATSHUB_PYTHON) candidates.push(process.env.STATSHUB_PYTHON);
  candidates.push(path.join(ROOT, '.venv', 'bin', 'python'));
  candidates.push(path.join(ROOT, '.venv', 'bin', 'python3'));
  candidates.push('python3');
  candidates.push('python');
  return candidates;
}

function canImport(candidate) {
  return new Promise((resolve) => {
    if (candidate.includes('/') && !fs.existsSync(candidate)) {
      resolve(false);
      return;
    }
    execFile(
      candidate,
      ['-c', 'import curl_cffi'],
      { timeout: 20000, windowsHide: true },
      (error) => resolve(!error),
    );
  });
}

async function resolvePython() {
  if (pythonPromise) return pythonPromise;
  pythonPromise = (async () => {
    for (const candidate of pythonCandidates()) {
      if (await canImport(candidate)) return candidate;
    }
    return null;
  })();
  return pythonPromise;
}

export async function statsHubStatus() {
  const python = await resolvePython();
  return {
    ready: Boolean(python),
    python,
    reason: python ? null : 'StatsHub sync needs python3 with the curl_cffi package.',
  };
}

function runBridge(urls, timeoutSeconds, options = {}) {
  return new Promise((resolve) => {
    resolvePython().then((resolved) => {
      if (!resolved) {
        resolve({ error: 'python-curl_cffi-unavailable' });
        return;
      }
      const child = execFile(
        resolved,
        [SCRIPT],
        {
          timeout: SPAWN_TIMEOUT,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        },
        (error, stdout, stderr) => {
          if (error) {
            console.error(`[statshub] bridge failed: ${error.message} ${stderr || ''}`.trim());
            resolve({ error: error.message });
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch (parseError) {
            console.error(`[statshub] bridge returned invalid JSON: ${parseError.message}`);
            resolve({ error: 'invalid-bridge-output' });
          }
        },
      );
      child.stdin.on('error', () => {});
      child.stdin.end(
        JSON.stringify({
          urls,
          timeout: timeoutSeconds,
          binary: Boolean(options.binary),
          headers: options.headers || {},
        }),
      );
    });
  });
}

function pruneCache() {
  while (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

/**
 * Fetch several StatsHub URLs, returning a Map of url -> parsed JSON (or null).
 * Results are cached in memory; a failed refresh falls back to the cached copy.
 */
export async function fetchJsonBatch(urls, options = {}) {
  const { ttl = 5 * 60 * 1000, timeoutSeconds = 30 } = options;
  const results = new Map();
  const missing = [];

  for (const url of urls) {
    const cached = cache.get(url);
    if (cached && Date.now() - cached.timestamp < ttl) {
      results.set(url, cached.data);
    } else {
      missing.push(url);
    }
  }

  if (!missing.length) return results;

  const payload = await runBridge(missing, timeoutSeconds);
  if (payload?.error) {
    for (const url of missing) {
      const cached = cache.get(url);
      results.set(url, cached ? cached.data : null);
    }
    return results;
  }

  for (const entry of payload.results || []) {
    if (entry.error || entry.status !== 200) {
      const cached = cache.get(entry.url);
      if (!entry.error) {
        console.error(`[statshub] ${entry.status} ${entry.url}`);
      }
      results.set(entry.url, cached ? cached.data : null);
      continue;
    }

    let data = null;
    try {
      data = JSON.parse(entry.body);
    } catch {
      console.error(`[statshub] non-JSON response from ${entry.url}`);
    }

    if (data === null) {
      const cached = cache.get(entry.url);
      results.set(entry.url, cached ? cached.data : null);
      continue;
    }

    cache.set(entry.url, { data, timestamp: Date.now() });
    results.set(entry.url, data);
  }

  pruneCache();
  return results;
}

export async function fetchJson(url, options) {
  const results = await fetchJsonBatch([url], options);
  return results.get(url) ?? null;
}

/* ---------- plain-text feeds (Flashscore/Soccerway) ---------- */

const textCache = new Map();
const MAX_TEXT_ENTRIES = 120;

/**
 * Fetch several plain-text feed URLs (Soccerway's feeds are `÷`/`¬` encoded,
 * not JSON). Cache keeps the parsed text so repeat detail views stay cheap.
 */
export async function fetchTextBatch(urls, options = {}) {
  const { ttl = 5 * 60 * 1000, timeoutSeconds = 25, headers = {} } = options;
  const results = new Map();
  const missing = [];

  for (const url of urls) {
    const cached = textCache.get(url);
    if (cached && Date.now() - cached.timestamp < ttl) {
      results.set(url, cached.data);
    } else {
      missing.push(url);
    }
  }

  if (!missing.length) return results;

  const payload = await runBridge(missing, timeoutSeconds, { headers });
  if (payload?.error) {
    for (const url of missing) {
      const cached = textCache.get(url);
      results.set(url, cached ? cached.data : null);
    }
    return results;
  }

  for (const entry of payload.results || []) {
    if (entry.error || entry.status !== 200) {
      const cached = textCache.get(entry.url);
      results.set(entry.url, cached ? cached.data : null);
      continue;
    }
    const text = typeof entry.body === 'string' ? entry.body : null;
    if (text === null) {
      const cached = textCache.get(entry.url);
      results.set(entry.url, cached ? cached.data : null);
      continue;
    }
    textCache.set(entry.url, { data: text, timestamp: Date.now() });
    results.set(entry.url, text);
  }

  while (textCache.size > MAX_TEXT_ENTRIES) {
    textCache.delete(textCache.keys().next().value);
  }

  return results;
}

export async function fetchText(url, options) {
  const results = await fetchTextBatch([url], options);
  return results.get(url) ?? null;
}

/* ---------- images (Cloudflare-protected hosts) ---------- */

const imageCache = new Map();
const MAX_IMAGE_ENTRIES = 400;
const IMAGE_TTL = 24 * 60 * 60 * 1000;
let imageQueue = new Map();
let imageTimer = null;

async function flushImageQueue() {
  const batch = imageQueue;
  imageQueue = new Map();
  imageTimer = null;
  const urls = [...batch.keys()];

  const payload = await runBridge(urls, 30, { binary: true });
  if (payload?.error) {
    for (const resolve of batch.values()) resolve(null);
    return;
  }

  const seen = new Set();
  for (const entry of payload.results || []) {
    const resolve = batch.get(entry.url);
    if (!resolve) continue;
    seen.add(entry.url);
    const contentType = String(entry.contentType || '')
      .split(';')[0]
      .trim();
    if (entry.error || entry.status !== 200 || !entry.base64 || !contentType.startsWith('image/')) {
      resolve(null);
      continue;
    }
    const buffer = Buffer.from(entry.base64, 'base64');
    if (!buffer.length || buffer.length > 2 * 1024 * 1024) {
      resolve(null);
      continue;
    }
    const record = { buffer, contentType, timestamp: Date.now() };
    imageCache.set(entry.url, record);
    resolve(record);
  }

  for (const [url, resolve] of batch) {
    if (!seen.has(url)) resolve(null);
  }

  while (imageCache.size > MAX_IMAGE_ENTRIES) {
    imageCache.delete(imageCache.keys().next().value);
  }
}

/**
 * Fetch one image through the Chrome-impersonating bridge.
 * Concurrent callers are coalesced so a grid of player photos is one spawn.
 */
export async function fetchImage(url) {
  const cached = imageCache.get(url);
  if (cached && Date.now() - cached.timestamp < IMAGE_TTL) return cached;

  return new Promise((resolve) => {
    imageQueue.set(url, resolve);
    if (!imageTimer) imageTimer = setTimeout(flushImageQueue, 25);
  });
}
