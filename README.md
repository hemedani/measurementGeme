# شهر اندازه‌گیری — Measurement City

Three self-contained measurement games for a third-grade class, plus a landing page and a
zero-dependency Node server to host them on a VPS.

| Folder      | Game                             | Notes                                                  |
| ----------- | -------------------------------- | ------------------------------------------------------ |
| `deepseek/` | ترازو، اندازه‌گیری و مقیاس‌ها       | 6 stations, 30 levels, sound, badges, printable certificate. Fully offline. |
| `qwen/`     | شهر اندازه‌گیری                   | 6 stations incl. a unit-conversion factory and final exam. |
| `cluade/`   | بازارچهٔ اندازه‌گیری                | Sequential short levels, night mode, certificate.       |

`index.html` at the root is the landing page that links all three.

> `ignoreAssets/` holds the original research material and is **git-ignored and never served** —
> the server returns 404 for it even if the folder exists on disk.

---

## Run locally

```bash
node server.js          # http://localhost:8080
PORT=3000 node server.js
npm run dev             # same, with --watch restart on file changes
```

No `npm install` needed: the project has **zero dependencies**.

---

## Deploy on the VPS

### 1. Get the code onto the server

```bash
ssh you@your-vps
git clone <your-remote-url> sareh && cd sareh
# or: rsync -av --exclude ignoreAssets --exclude node_modules ./ you@vps:/var/www/sareh/
```

Requires **Node.js 18+** (`node -v`). For a fresh install, [nvm](https://github.com/nvm-sh/nvm) or
NodeSource is easiest.

### 2. Start it under PM2

```bash
npm i -g pm2            # if not already installed
pm2 start ecosystem.config.js
pm2 save                # remember the process list
pm2 startup             # print + run the command it gives you, so it survives a reboot
```

Verify:

```bash
pm2 status
pm2 logs sareh-games --lines 30
curl -s http://127.0.0.1:8080/healthz   # -> ok
```

The site is now live on port **8080**. Point a domain at it with the Nginx block below.

### 3. Common commands

| Task              | Command                       |
| ----------------- | ----------------------------- |
| Reload after edit | `pm2 reload sareh-games`      |
| Restart           | `pm2 restart sareh-games`     |
| Stop              | `pm2 stop sareh-games`        |
| Logs              | `pm2 logs sareh-games`        |
| Delete            | `pm2 delete sareh-games`      |

Pulling updates:

```bash
cd /path/to/sareh && git pull && pm2 reload sareh-games
```

Content is read from disk per request, so a `git pull` alone is enough for HTML/CSS changes —
`reload` is only needed when `server.js` itself changes.

### 4. Scale (optional)

The server is safe in cluster mode (it keeps only an in-memory compression cache):

```bash
WEB_INSTANCES=max pm2 start ecosystem.config.js   # one worker per CPU core
```

### 5. Sharing the VPS with other PM2 apps

If the server already runs other apps under PM2, keep **one** root config that lists all of them
instead of a separate `ecosystem.config.js` per project — otherwise `pm2 save` fights over which
list is authoritative.

`deploy/ecosystem.root.config.js` is that file: copy it over the existing root config and reload.

```bash
cp deploy/ecosystem.root.config.js /root/work/ecosystem.config.js
cd /root/work
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
```

`startOrReload` is idempotent — apps already running get a graceful reload, missing ones get
started, and re-running it never creates duplicates. It reads the config fresh, so it is the
right command after any edit (plain `pm2 start` on an existing app just errors out).

> **If you already started this project from its own folder**, run `pm2 delete sareh-games`
> before the first `startOrReload`. Two processes on port 8080 means one of them
> crash-loops on `EADDRINUSE`.

The root config keeps the app name `sareh-games`, which is the name the project's own
`ecosystem.config.js` uses — so either file can manage the same process without orphaning it.
It also pins the interpreter to the fnm-managed node, because `server.js` uses `node:`-prefixed
requires that need Node 14.18+ and must not depend on whatever node PM2 itself was launched with.

Verify the toolchain path exists before the first start:

```bash
ls -l /root/.local/share/fnm/aliases/default/bin/node
ss -ltnp | grep -E ':(8080)\b'      # should print nothing while it is stopped
```

---

## Configuration

All configuration is via environment variables — set them in `ecosystem.config.js` under `env`,
or export them before `node server.js`.

| Variable    | Default     | Meaning                                              |
| ----------- | ----------- | ---------------------------------------------------- |
| `PORT`      | `8080`      | Port to bind.                                        |
| `HOST`      | `0.0.0.0`   | Interface to bind. Use `127.0.0.1` behind a proxy.   |
| `SITE_ROOT` | `__dirname` | Directory to serve.                                  |
| `NODE_ENV`  | –           | `production` for production logging.                 |
| `QUIET`     | –           | `1` disables the per-request log line.               |

---

## Nginx reverse proxy (recommended)

Terminate TLS at Nginx and let it serve nothing itself — just proxy to Node.

```nginx
server {
    listen 80;
    server_name games.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name games.example.com;

    ssl_certificate     /etc/letsencrypt/live/games.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/games.example.com/privkey.pem;

    # Let Node do the compressing; don't double-compress.
    gzip off;

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 70s;
    }
}
```

With Nginx in front, set `HOST=127.0.0.1` in `ecosystem.config.js` so port 8080 is not exposed
publicly, then `pm2 reload sareh-games`.

`certbot --nginx -d games.example.com` issues the certificate.

---

## What the server does

`server.js` — Node built-ins only, ~350 lines:

- **Routing** — `/` → `index.html`, `/deepseek` → 301 → `/deepseek/` → `index.html`.
- **Compression** — brotli (quality 5) preferred, gzip fallback, cached in memory with an LRU
  bound (48 MB / 96 entries). The 166 KB game ships as ~38 KB over the wire (−77 %).
- **Caching** — strong `ETag` + `Last-Modified`, `304 Not Modified` on revalidation. HTML is
  `no-cache` (always revalidates, so deploys are instant); everything else is cached for a week
  with `stale-while-revalidate`.
- **Range requests** — single byte ranges for audio/video, `416` on unsatisfiable.
- **Security** — path-traversal protection (both `../` and `%2e%2e`), dot-segments rejected,
  `.git` / `node_modules` / `ignoreAssets` / `logs` never served, `nosniff`,
  `Referrer-Policy: same-origin`, `GET`/`HEAD` only.
- **Ops** — `/healthz` for uptime monitors, graceful `SIGTERM` shutdown (important for
  `pm2 reload` zero-downtime restarts), `keepAliveTimeout` above typical proxy timeouts to
  avoid intermittent 502s.

---

## Notes on the games

- Everything is a single `index.html` per game — no build step, no CDN, no external fonts or
  images, no network calls. They work offline, from a USB stick, or on a school tablet.
- `deepseek/` is fully self-contained; `qwen/` and `cluade/` link Google Fonts and fall back to
  system fonts offline.
- Progress is stored in `localStorage` per browser, so each child on a shared tablet keeps their
  own stars.
