#!/usr/bin/env node
// ============================================================================
// serverskins-data — görsel aynalayıcı (self-host, GitHub-yedekli)
// ----------------------------------------------------------------------------
// TÜM katalog görsellerini (skin/sticker/ajan/eldiven/bıçak/müzik/pin) uzak
// Steam CDN URL'lerinden indirir, `images/<kategori>/<ad>.png` altına DETERMİNİSTİK
// adla kaydeder (item id/anahtar bazlı) ve manifest yazar. Böylece görseller BİZE
// ait olur ve GitHub'da yedeklenir.
//
// Kullanım:
//   node scripts/mirror-images.mjs                 # indir (resumable — varsa atlar)
//   node scripts/mirror-images.mjs --concurrency 24
//   node scripts/mirror-images.mjs --rewrite       # catalog/ URL'lerini BİZE çevir
//   node scripts/mirror-images.mjs --rewrite --backend <dir>  # + backend/data'yı da
//   node scripts/mirror-images.mjs --base <url>    # OUR_BASE'i değiştir
//
// Akış (önerilen):
//   1) node scripts/mirror-images.mjs              → images/ doldurulur + manifest
//   2) git add images && git commit && git push    → GitHub'a yedekle
//   3) node scripts/mirror-images.mjs --rewrite --backend ../serverskins/backend/data
//      → catalog/ + backend/data imageUrl'leri BİZİM raw URL'imize çevrilir
//   4) commit + push (catalog + backend)
//
// GÜVENLİK: URL'ler yalnızca ilgili görsel images/ altında MEVCUTSA çevrilir
// (--rewrite). Böylece push edilmemiş görsel için kırık URL oluşmaz. İndirilmemiş
// görseller mevcut (Steam CDN) URL'lerinde kalır — sessiz kırılma yok.
//
// Bağımlılık YOK (saf Node + global fetch). Sessiz fallback YOK.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'catalog');
const IMAGES = path.join(ROOT, 'images');
const MANIFEST = path.join(IMAGES, 'manifest.json');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
const REWRITE = process.argv.includes('--rewrite');
const CONCURRENCY = parseInt(arg('--concurrency', '24'), 10);
const OUR_BASE = arg('--base', 'https://raw.githubusercontent.com/skytexdev/serverskins-data/main/images').replace(/\/+$/, '');
const BACKEND = (() => {
  const i = process.argv.indexOf('--backend');
  return i !== -1 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
})();

const sanitize = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const isRemote = u => typeof u === 'string' && /^https?:\/\//i.test(u);

// --- Her katalog kaydını (kategori, dosyaadı) ile eşle -----------------------
// Dönüş: entry nesnesine erişim + { category, file } . Backend ile birebir aynı
// adlandırma (localize-images.js ile tutarlı): skins=<itemKey>_<skinId>, agent_,
// sticker_, keychain_, music_, pin_.
function nameForSkin(itemKey, skinId) { return `${sanitize(itemKey)}_${sanitize(skinId)}.png`; }
function nameForFlat(prefix, id) { return `${prefix}_${sanitize(id)}.png`; }

// Katalog dosyalarını gez; her görsel-taşıyan kayıt için işleyici çağır.
// cb(entry, category, file)  — entry.imageUrl okunur/yazılır.
function eachImage(dir, cb) {
  const nested = [['weapons.json', 'skins'], ['knives.json', 'skins'], ['gloves.json', 'skins']];
  for (const [f, cat] of nested) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    let changed = false;
    for (const [itemKey, item] of Object.entries(d)) {
      for (const s of (item.skins || [])) if (cb(s, cat, nameForSkin(itemKey, s.skinId))) changed = true;
    }
    if (changed) fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
  }
  // agents (nested team/group)
  const ap = path.join(dir, 'agents.json');
  if (fs.existsSync(ap)) {
    const d = JSON.parse(fs.readFileSync(ap, 'utf8'));
    let changed = false;
    for (const team of Object.values(d)) for (const g of Object.values(team)) for (const s of (g.skins || [])) {
      if (cb(s, 'agents', nameForFlat('agent', s.skinId))) changed = true;
    }
    if (changed) fs.writeFileSync(ap, JSON.stringify(d, null, 2), 'utf8');
  }
  // flat cosmetics
  const flat = [['stickers.json', 'stickers', 'sticker'], ['keychains.json', 'keychains', 'keychain'],
    ['musickits.json', 'musickits', 'music'], ['collectibles.json', 'pins', 'pin'], ['pins.json', 'pins', 'pin']];
  for (const [f, cat, prefix] of flat) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    let changed = false;
    for (const s of d) if (cb(s, cat, nameForFlat(prefix, s.id))) changed = true;
    if (changed) fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
  }
}

// --- İndirme ----------------------------------------------------------------
async function downloadOne(url, dest, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 67) throw new Error(`çok küçük (${buf.length}b)`);
      // PNG imzası (Steam economy görselleri PNG'dir)
      if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) {
        // JPEG de kabul (bazı görseller jpg olabilir)
        if (!(buf[0] === 0xff && buf[1] === 0xd8)) throw new Error('geçersiz görsel imzası');
      }
      fs.writeFileSync(dest, buf);
      return buf.length;
    } catch (e) {
      if (attempt === tries) throw e;
      await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }
}

async function runPool(tasks, limit) {
  let idx = 0, ok = 0, skip = 0, fail = 0, done = 0;
  const fails = [];
  async function worker() {
    while (idx < tasks.length) {
      const my = idx++;
      const t = tasks[my];
      try {
        const r = await t();
        if (r === 'skip') skip++; else ok++;
      } catch (e) { fail++; fails.push(`${tasks[my].label}: ${e.message}`); }
      if (++done % 200 === 0) console.log(`  ${done}/${tasks.length} (indi:${ok} atla:${skip} hata:${fail})`);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return { ok, skip, fail, fails };
}

// ============================================================================
if (REWRITE) {
  console.log(`— URL yeniden yazma (BİZE) — base: ${OUR_BASE}`);
  let rewritten = 0, missing = 0, kept = 0;
  const missingList = [];
  const doRewrite = (entry, category, file) => {
    if (!entry.imageUrl) return false;
    const local = path.join(IMAGES, category, file);
    const target = `${OUR_BASE}/${category}/${file}`;
    if (entry.imageUrl === target) { kept++; return false; }
    if (fs.existsSync(local) && fs.statSync(local).size > 0) {
      entry.imageUrl = target; rewritten++; return true;
    }
    // Görsel yoksa mevcut URL'de bırak (kırma). Sadsay.
    missing++;
    if (missingList.length < 20) missingList.push(`${category}/${file}`);
    return false;
  };
  console.log('  catalog/ ...');
  eachImage(CATALOG, doRewrite);
  if (BACKEND) { console.log(`  backend: ${BACKEND} ...`); eachImage(BACKEND, doRewrite); }
  console.log(`\n✅ Yeniden yazıldı: ${rewritten} | zaten bizde: ${kept} | görsel yok (dokunulmadı): ${missing}`);
  if (missing) console.log('  eksik örnekleri:', missingList.join(', '));
  process.exit(0);
}

// --- İndirme modu -----------------------------------------------------------
console.log(`— Görsel aynalama (indirme) — ${CONCURRENCY} eşzamanlı`);
fs.mkdirSync(IMAGES, { recursive: true });
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};

const tasks = [];
const seen = new Set();
eachImage(CATALOG, (entry, category, file) => {
  const rel = `${category}/${file}`;
  if (seen.has(rel)) return false;
  seen.add(rel);
  const url = entry.imageUrl;
  if (!isRemote(url)) return false; // yerel/null → indirme
  const dest = path.join(IMAGES, category, file);
  const task = async () => {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { manifest[rel] ??= { url, category }; return 'skip'; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const bytes = await downloadOne(url, dest);
    manifest[rel] = { url, category, bytes };
    return 'ok';
  };
  task.label = rel;
  tasks.push(task);
  return false;
});

console.log(`  ${tasks.length} indirilecek/kontrol edilecek görsel (${seen.size} benzersiz kayıt)`);
const res = await runPool(tasks, CONCURRENCY);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\n✅ İndirme: ${res.ok} indi, ${res.skip} zaten vardı, ${res.fail} hata.`);
console.log(`   Manifest: ${MANIFEST} (${Object.keys(manifest).length} kayıt)`);
if (res.fail) {
  fs.writeFileSync(path.join(IMAGES, 'download-errors.json'), JSON.stringify(res.fails, null, 2), 'utf8');
  console.log(`   ⚠️  ${res.fail} hata: images/download-errors.json (yeniden çalıştırınca kaldığı yerden devam eder)`);
}
