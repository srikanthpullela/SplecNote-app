// Patches the app version in tauri.conf.json, Cargo.toml, and package.json.
// Run from the repo root: APP_VERSION=0.1.42 node .github/scripts/bump-version.js

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const version = process.env.APP_VERSION;
if (!version) {
  console.error('Error: APP_VERSION environment variable is required');
  process.exit(1);
}

const root = process.cwd();

// ── tauri.conf.json ────────────────────────────────────────────────────────────
const tauriConfPath = join(root, 'src-tauri', 'tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
console.log(`  tauri.conf.json → ${version}`);

// ── src-tauri/Cargo.toml ───────────────────────────────────────────────────────
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8')
  .replace(/^(version\s*=\s*)"[^"]*"/m, `$1"${version}"`);
writeFileSync(cargoPath, cargo);
console.log(`  Cargo.toml      → ${version}`);

// ── package.json ───────────────────────────────────────────────────────────────
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`  package.json    → ${version}`);

console.log(`\nVersion bumped to ${version}`);
