// /root/work/ecosystem.config.js
//
// ONE PM2 file for every app on this server.
//
//   pm2 startOrReload ecosystem.config.js --update-env
//   pm2 save
//
// `startOrReload` is idempotent and is what you want after any change:
//   • apps already running  -> graceful reload (same name/port/env, no downtime)
//   • apps not running yet  -> started
// So re-running it never duplicates processes. `pm2 start` on an existing app
// would instead complain about the script already being launched.
//
// After `pm2 save`, `pm2 startup` (once, if you have not) keeps everything
// coming back after a reboot.

// Stable paths to the toolchains managed by fnm / deno.
// These never change, unlike /run/user/0/fnm_multishells/<id>/bin.
const FNM_BIN = '/root/.local/share/fnm/aliases/default/bin';
const DENO_BIN = '/root/.deno/bin';

const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const PATH_DENO = `${DENO_BIN}:${FNM_BIN}:${SYSTEM_PATH}`;
const PATH_FNM = `${FNM_BIN}:${SYSTEM_PATH}`;

module.exports = {
  apps: [
    // ───────────────────────── Backends (Deno) ─────────────────────────
    {
      name: 'SATEK-BC',
      cwd: '/root/work/lesanSatek/back',
      script: 'mod.ts',
      interpreter: `${DENO_BIN}/deno`,
      interpreter_args: 'run -A',
      env: {
        PATH: PATH_DENO,
        SERVER_PORT: 1370,
        ENV: 'development',
      },
    },
    {
      name: 'ZiWound-BC',
      cwd: '/root/work/ziwound/back',
      script: 'mod.ts',
      interpreter: `${DENO_BIN}/deno`,
      interpreter_args: 'run -A',
      env: {
        PATH: PATH_DENO,
        SERVER_PORT: 1406,
        ENV: 'development',
      },
    },

    // ──────────────────────── Frontends (Next.js) ──────────────────────
    {
      name: 'SSATEK-FR',
      cwd: '/root/work/lesanSatek/front',
      script: `${FNM_BIN}/pnpm`,
      args: 'start',
      interpreter: 'none',
      env: {
        PATH: PATH_FNM,
        PORT: 3044,
        NEXT_PUBLIC_LESAN_URL: 'http://185.239.0.14:1370',
        LESAN_URL: 'http://185.239.0.14:1370',
        COOKIE_SECURE: 'false',
      },
    },
    {
      name: 'Alphabet-FR',
      cwd: '/root/work/alphabet',
      script: `${FNM_BIN}/pnpm`,
      args: 'start',
      interpreter: 'none',
      env: {
        PATH: PATH_FNM,
        PORT: 3050,
      },
    },
    {
      name: 'REPORT-FR',
      cwd: '/root/work/report-studio',
      script: `${FNM_BIN}/pnpm`,
      args: 'start',
      interpreter: 'none',
      env: {
        PATH: PATH_FNM,
        PORT: 3055,
      },
    },
    {
      name: 'ZiWound-FR',
      cwd: '/root/work/ziwound/front',
      script: `${FNM_BIN}/pnpm`,
      args: 'start',
      interpreter: 'none',
      env: {
        PATH: PATH_FNM,
        // Your original command used APP_PORT; Next.js actually reads PORT.
        // Both are set so nothing breaks.
        PORT: 3000,
        APP_PORT: 3000,
        NEXT_PUBLIC_LESAN_URL: 'http://185.239.0.14:1406',
        LESAN_URL: 'http://185.239.0.14:1406',
        COOKIE_SECURE: 'false',
      },
    },
    {
      name: 'Pejvak-BC',
      cwd: '/root/work/pejvak/back',
      script: 'mod.ts',
      interpreter: `${DENO_BIN}/deno`,
      interpreter_args: 'run -A',
      env: {
        PATH: PATH_DENO,
        APP_PORT: 1243,
        ENV: 'production',
      },
    },

    // ─────────────── Static site: measurement games (Node) ─────────────
    // Persian grade-3 measurement games — a landing page plus three
    // self-contained games, served by a zero-dependency Node server.
    // No build step: there is nothing to `pnpm build` or `pnpm start`,
    // so this app needs no install phase at all.
    //
    // Name kept as `sareh-games` to match the config that ships inside
    // measurementGeme/. If you already started that one, run
    //   pm2 delete sareh-games
    // BEFORE the first `startOrReload` below — otherwise two processes end up
    // fighting over port 8080 and one of them crash-loops on EADDRINUSE.
    //
    // Port 8080 is free: the other apps use 1243/1370/1406/3000/3044/3050/3055.
    {
      name: 'sareh-games',
      cwd: '/root/work/measurementGeme',
      script: 'server.js',
      // Pin the fnm node. server.js uses `node:`-prefixed requires, which need
      // Node >= 14.18; relying on whatever node PM2 itself was started with is
      // how you get a surprise crash-loop after a pm2 upgrade.
      interpreter: `${FNM_BIN}/node`,

      env: {
        PATH: PATH_FNM,
        NODE_ENV: 'production',
        PORT: 8080,
        HOST: '0.0.0.0', // reachable as http://185.239.0.14:8080
      },

      // It only streams files and caches compressed copies; 256M is generous.
      max_memory_restart: '256M',

      // Must stay above server.js's own 5s graceful-shutdown window,
      // otherwise PM2 SIGKILLs it mid-request on every reload.
      kill_timeout: 6000,

      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      time: true,
    },
  ],
};
