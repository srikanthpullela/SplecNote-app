// Generates GitHub Pages artifacts for Splec Note:
//   pages/updates/latest.json  — Tauri in-app updater manifest
//   pages/index.html           — download landing page
//
// Required env vars:
//   APP_VERSION, GITHUB_REPOSITORY
// Optional env vars:
//   MAC_SIG, WIN_SIG, PUB_DATE, PAGES_DIR

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const { APP_VERSION, GITHUB_REPOSITORY, MAC_SIG, WIN_SIG, PAGES_DIR } = process.env;
const PUB_DATE = process.env.PUB_DATE ?? new Date().toISOString();

if (!APP_VERSION || !GITHUB_REPOSITORY) {
  console.error('Error: APP_VERSION and GITHUB_REPOSITORY are required');
  process.exit(1);
}

const pagesDir = PAGES_DIR ?? 'pages';
const updatesDir = join(pagesDir, 'updates');
mkdirSync(updatesDir, { recursive: true });

const versionedBase = `https://github.com/${GITHUB_REPOSITORY}/releases/download/v${APP_VERSION}`;
const latestBase    = `https://github.com/${GITHUB_REPOSITORY}/releases/latest/download`;

// ── Update manifest ────────────────────────────────────────────────────────────
const platforms = {};
if (MAC_SIG?.trim()) {
  const url = `${versionedBase}/SplecNote-mac-universal.app.tar.gz`;
  platforms['darwin-aarch64'] = { signature: MAC_SIG, url };
  platforms['darwin-x86_64']  = { signature: MAC_SIG, url };
}
if (WIN_SIG?.trim()) {
  platforms['windows-x86_64'] = {
    signature: WIN_SIG,
    url: `${versionedBase}/SplecNote-windows.nsis.zip`,
  };
}

if (Object.keys(platforms).length === 0) {
  console.warn('Warning: no signatures — latest.json will have no platforms (in-app updater disabled)');
}

const manifest = {
  version: APP_VERSION,
  notes: `Automated build v${APP_VERSION}`,
  pub_date: PUB_DATE,
  platforms,
};

writeFileSync(join(updatesDir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`✓ ${pagesDir}/updates/latest.json  (v${APP_VERSION}, ${Object.keys(platforms).length} platform(s))`);

// ── Download page ──────────────────────────────────────────────────────────────
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Splec Note — Download</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background: #0d1117; color: #e6edf3;
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
    }
    .card {
      background: #161b22; border: 1px solid #30363d; border-radius: 16px;
      padding: 3rem; max-width: 480px; width: calc(100% - 2rem); text-align: center;
    }
    h1 { font-size: 2.25rem; font-weight: 700; margin-bottom: 0.5rem; }
    .sub { color: #8b949e; margin-bottom: 2.5rem; font-size: 1rem; }
    .btn {
      display: flex; align-items: center; justify-content: center; gap: 0.6rem;
      padding: 0.85rem 1.5rem; border-radius: 10px; text-decoration: none;
      font-weight: 600; font-size: 1rem; margin-bottom: 0.75rem; transition: opacity .15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn-mac { background: #1f6feb; color: #fff; }
    .btn-win { background: #238636; color: #fff; }
    .meta { color: #484f58; font-size: 0.8rem; margin-top: 1.75rem; }
    .meta a { color: #58a6ff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Splec Note</h1>
    <p class="sub">A lightweight, distinctive editor for notes &amp; code.</p>
    <a class="btn btn-mac" href="${latestBase}/SplecNote-mac-universal.dmg">
      &#xF8FF; Download for Mac &nbsp;<small>(Universal)</small>
    </a>
    <a class="btn btn-win" href="${latestBase}/SplecNote-windows-setup.exe">
      &#x229E; Download for Windows
    </a>
    <p class="meta">
      Version v${APP_VERSION}&nbsp;&nbsp;·&nbsp;&nbsp;
      <a href="https://github.com/${GITHUB_REPOSITORY}/releases">All releases</a>
    </p>
  </div>
</body>
</html>
`;

writeFileSync(join(pagesDir, 'index.html'), html);
console.log(`✓ ${pagesDir}/index.html`);
