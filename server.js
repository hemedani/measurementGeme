'use strict';

/**
 * Static file server for the "Measurement City" game collection.
 * No dependencies — Node.js built-ins only. Safe to run under PM2 in cluster mode.
 *
 *   node server.js                 # http://localhost:8080
 *   PORT=3000 node server.js
 *
 * Features: ETag + 304, brotli/gzip with an in-memory cache, single-range requests,
 * directory index resolution, path-traversal protection, graceful shutdown.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

/* ------------------------------------------------------------------ config */

const ROOT = path.resolve(process.env.SITE_ROOT || __dirname);
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const QUIET = process.env.QUIET === '1';
const IS_PROD = process.env.NODE_ENV === 'production';

/** Never served, even if present on disk. */
const BLOCKED = new Set(['.git', '.workbuddy-ai', 'node_modules', 'ignoreAssets', 'logs']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8'
};

/** Extensions worth compressing. Images/video/fonts are already compressed. */
const COMPRESSIBLE = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml', '.map', '.webmanifest']);

/* --------------------------------------------------- compressed-file cache */

const CACHE_MAX_BYTES = 48 * 1024 * 1024;
const CACHE_MAX_ENTRIES = 96;
const cache = new Map(); // key -> { buf, len }
let cacheBytes = 0;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  // refresh recency (Map keeps insertion order)
  cache.delete(key);
  cache.set(key, hit);
  return hit.buf;
}

function cacheSet(key, buf) {
  if (buf.length > CACHE_MAX_BYTES / 4) return; // don't let one file dominate
  if (cache.has(key)) return;
  cache.set(key, buf);
  cacheBytes += buf.length;
  while (cacheBytes > CACHE_MAX_BYTES || cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cacheBytes -= cache.get(oldest.value).length;
    cache.delete(oldest.value);
  }
}

/* ----------------------------------------------------------------- helpers */

function setCommonHeaders(res, filePath, stat, etag) {
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // HTML revalidates every load (304 is cheap); everything else can be cached hard.
  res.setHeader(
    'Cache-Control',
    ext === '.html' || ext === '.htm'
      ? 'no-cache'
      : 'public, max-age=604800, stale-while-revalidate=86400'
  );
}

function pickEncoding(req) {
  const header = req.headers['accept-encoding'];
  if (!header) return null;
  if (/\bbr\b/.test(header)) return 'br';
  if (/\bgzip\b/.test(header)) return 'gzip';
  return null;
}

function matchesEtag(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .some((v) => v === etag.replace(/^W\//, ''));
}

function sendError(res, status, message, extraHeaders) {
  const body = Buffer.from(
    `<!DOCTYPE html><html lang="fa" dir="rtl"><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${status}</title>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;` +
      `font-family:Tahoma,system-ui,sans-serif;background:#FFF8EE;color:#2F2B45;text-align:center">` +
      `<div><div style="font-size:56px;line-height:1">⚖️</div>` +
      `<h1 style="font-size:20px;margin:14px 0 6px">${message}</h1>` +
      `<p style="font-size:14px;color:#6D6786;margin:0 0 18px">این صفحه پیدا نشد.</p>` +
      `<a href="/" style="display:inline-block;background:#FF7A6B;color:#fff;text-decoration:none;` +
      `font-weight:bold;padding:10px 22px;border-radius:14px">بازگشت به خانه</a></div></body></html>`,
    'utf8'
  );
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...(extraHeaders || {})
  });
  res.end(body);
}

/* ------------------------------------------------------------ compression */

function compress(buf, encoding) {
  return encoding === 'br'
    ? zlib.brotliCompressSync(buf, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length
        }
      })
    : zlib.gzipSync(buf, { level: 6 });
}

/* ------------------------------------------------------------------ range */

function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  if (start > end || start >= size) return { invalid: true };
  return { start, end };
}

/* ---------------------------------------------------------------- handler */

async function serveFile(req, res, filePath, stat) {
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';

  setCommonHeaders(res, filePath, stat, etag);

  // Conditional request
  const inm = req.headers['if-none-match'];
  if (inm ? matchesEtag(inm, etag) : req.headers['if-modified-since'] === stat.mtime.toUTCString()) {
    res.writeHead(304);
    return res.end();
  }

  const encoding = COMPRESSIBLE.has(ext) && stat.size > 1024 ? pickEncoding(req) : null;
  const isHead = req.method === 'HEAD';

  if (encoding) {
    const key = `${filePath}|${etag}|${encoding}`;
    let body = cacheGet(key);
    if (!body) {
      const raw = await fsp.readFile(filePath);
      body = compress(raw, encoding);
      cacheSet(key, body);
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Content-Encoding': encoding,
      Vary: 'Accept-Encoding'
    });
    return isHead ? res.end() : res.end(body);
  }

  // Range request (useful for video/audio assets)
  const range = parseRange(req.headers.range, stat.size);
  if (range && range.invalid) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    return res.end();
  }
  if (range) {
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
      'Accept-Ranges': 'bytes'
    });
    if (isHead) return res.end();
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes'
  });
  if (isHead) return res.end();

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

async function handle(req, res) {
  const started = process.hrtime.bigint();

  res.on('finish', () => {
    if (QUIET) return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const len = res.getHeader('Content-Length') || '-';
    console.log(`${res.statusCode} ${req.method} ${req.url} ${ms.toFixed(1)}ms ${len}b`);
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, 405, 'این روش پشتیبانی نمی‌شود', { Allow: 'GET, HEAD' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return sendError(res, 400, 'نشانی نامعتبر');
  }
  if (pathname.includes('\0')) return sendError(res, 400, 'نشانی نامعتبر');

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('ok');
  }

  // Resolve safely inside ROOT
  const rel = path.normalize(pathname).replace(/^([/\\])+/, '');
  const target = path.join(ROOT, rel);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return sendError(res, 403, 'دسترسی به این مسیر ممکن نیست');
  }
  for (const segment of rel.split(/[/\\]/)) {
    if (segment.startsWith('.') || BLOCKED.has(segment)) {
      return sendError(res, 404, 'این صفحه پیدا نشد');
    }
  }

  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    return sendError(res, 404, 'این صفحه پیدا نشد');
  }

  if (stat.isDirectory()) {
    if (!pathname.endsWith('/')) {
      res.writeHead(301, { Location: pathname + '/', 'Content-Length': 0 });
      return res.end();
    }
    const indexPath = path.join(target, 'index.html');
    try {
      const indexStat = await fsp.stat(indexPath);
      return serveFile(req, res, indexPath, indexStat);
    } catch {
      return sendError(res, 404, 'این پوشه صفحهٔ اصلی ندارد');
    }
  }

  if (!stat.isFile()) return sendError(res, 404, 'این صفحه پیدا نشد');

  return serveFile(req, res, target, stat);
}

/* ----------------------------------------------------------------- server */

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('request failed:', req.method, req.url, err);
    if (!res.headersSent) sendError(res, 500, 'خطای سرور');
    else res.destroy();
  });
});

// Keep-alive slightly longer than a typical reverse proxy, to avoid 502s on reuse.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

server.listen(PORT, HOST, () => {
  const mode = IS_PROD ? 'production' : 'development';
  console.log(`⚖️  serving ${ROOT}`);
  console.log(`   http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (${mode}, pid ${process.pid})`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is already in use`);
  } else {
    console.error('server error:', err);
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, closing server…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
