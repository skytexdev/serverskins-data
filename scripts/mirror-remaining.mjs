// backend/data'da kalan Steam CDN URL'lerini BİZE çevir.
// Faz 1 (varsayılan): manifest'te olanları serverskins.com/images'e çevir; olmayanları
//   remaining-download.json'a yaz (sunucuda indirilecek).
// Faz 2 (--finish): indirilen kalanları da çevir (deterministik x/<hash>.png).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = 'c:/Users/meren/OneDrive/Desktop/serverskins/backend/data';
const BASE = 'https://serverskins.com/images';
const MANIFEST = path.join(ROOT, 'images', 'manifest.json');
const DLLIST = path.join(ROOT, 'remaining-download.json');
const finish = process.argv.includes('--finish');
const STEAM = /https?:\/\/[^"']*akamai\.steamstatic\.com\/economy\/image\/[^"']+/;

// url -> relpath (manifest'ten)
const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const url2path = new Map();
for (const [relpath, v] of Object.entries(man)) {
  const u = typeof v === 'string' ? v : v.url;
  if (u) url2path.set(u, relpath);
}
const hashFile = (u) => 'x/' + crypto.createHash('sha1').update(u).digest('hex').slice(0, 20) + '.png';

function jsonFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/generated/.test(p) || !/raw/.test(p)) out.push(...jsonFiles(p)); }
    else if (e.name.endsWith('.json') && !e.name.startsWith('bymykel_')) out.push(p);
  }
  return out;
}

let rewritten = 0, misses = new Map();
for (const f of jsonFiles(BACKEND)) {
  if (/generated[\\/]+raw/.test(f)) continue;
  let t = fs.readFileSync(f, 'utf8');
  let changed = false;
  t = t.replace(new RegExp(STEAM, 'g'), (u) => {
    if (url2path.has(u)) { rewritten++; changed = true; return `${BASE}/${url2path.get(u)}`; }
    if (finish) { rewritten++; changed = true; return `${BASE}/${hashFile(u)}`; }
    misses.set(u, hashFile(u));
    return u;
  });
  if (changed) fs.writeFileSync(f, t);
}

if (!finish) {
  const list = [...misses.entries()].map(([url, file]) => ({ url, file }));
  fs.writeFileSync(DLLIST, JSON.stringify(list, null, 0));
  console.log(`Faz1: manifest'ten çevrilen ${rewritten} | indirilecek kalan (benzersiz): ${list.length}`);
  console.log(`Liste: ${DLLIST}`);
} else {
  console.log(`Faz2: kalanlar da çevrildi (+${rewritten}).`);
}
