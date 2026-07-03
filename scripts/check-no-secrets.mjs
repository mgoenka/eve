#!/usr/bin/env node
// Fails the build if any secret-looking string is present in dist/.
// This is the last line of defense against accidentally bundling an API key
// into the client (see the no-client-side-secrets rule). Eve talks to Gemini,
// Cloud TTS, Stripe, and the Meta/Instagram Graph API — every one of those
// keys must stay server-side, so none may ever appear in the client bundle.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const PATTERNS = [
  { name: 'Google API key', re: /AIzaSy[A-Za-z0-9_-]{33}/ },
  { name: 'Google OAuth client secret', re: /GOCSPX-[A-Za-z0-9_-]{10,}/ },
  { name: 'Stripe secret key', re: /sk_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { name: 'Stripe restricted key', re: /rk_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { name: 'Stripe webhook secret', re: /whsec_[A-Za-z0-9]{16,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  // Catch a bare 32-hex secret (Meta app secret / TMDB-style key) only when it
  // sits next to a secret assignment, so we don't flag ordinary content hashes.
  { name: 'generic hex secret', re: /(?:api_key|apikey|client_secret|app_secret)["'`\s:=]+["'`]?[a-f0-9]{32}/i },
];

function walk(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(walk(full));
    else files.push(full);
  }
  return files;
}

let files = [];
try {
  files = walk(DIST);
} catch {
  console.error(`check-no-secrets: ${DIST}/ not found, skipping`);
  process.exit(0);
}

let found = false;
for (const file of files) {
  if (!/\.(js|mjs|cjs|html|json|css|map|txt)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const { name, re } of PATTERNS) {
    const m = text.match(re);
    if (m) {
      console.error(`check-no-secrets: FAIL - ${name} found in ${file}: ${m[0].slice(0, 20)}...`);
      found = true;
    }
  }
}

if (found) {
  console.error('check-no-secrets: a secret was found in the client bundle. Fix the build before deploying.');
  process.exit(1);
}
console.log('check-no-secrets: bundle clean, no secrets found.');
