#!/usr/bin/env node
// ============================================================================
// serverskins-data — catalog/ çıktısını serverskins/backend/data'ya uygular
// ----------------------------------------------------------------------------
// Kullanım:
//   node scripts/apply-to-backend.mjs                     # DRY-RUN (hiçbir şey yazmaz)
//   node scripts/apply-to-backend.mjs --write             # gerçekten uygular
//   node scripts/apply-to-backend.mjs --backend <dizin>   # backend/data yolu
//                (varsayılan: ../serverskins/backend/data)
//
// Uygulama kuralları:
//   stickers.json, keychains.json, musickits.json, pins.json, agents.json
//     → katalogdan YENİDEN yazılır (backend şemasına projeksiyon;
//       agents'ta yanlış rarity'ler böylece düzelir).
//   weapons/*.json, knives.json, gloves.json
//     → MERGE: eksik skin eklenir, eksik imageUrl doldurulur, mevcut kayıt
//       SİLİNMEZ ve mevcut alanların üzerine yazılmaz. Yeni item, class
//       alanına göre doğru dosyaya eklenir.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'catalog');

const WRITE = process.argv.includes('--write');
const bIdx = process.argv.indexOf('--backend');
const BACKEND = bIdx !== -1
  ? path.resolve(process.argv[bIdx + 1])
  : path.join(ROOT, '..', 'serverskins', 'backend', 'data');

if (!fs.existsSync(BACKEND)) {
  throw new Error(`HATA: backend/data bulunamadı: ${BACKEND} — --backend <dizin> ver`);
}
const cat = name => {
  const p = path.join(CATALOG, name);
  if (!fs.existsSync(p)) throw new Error(`HATA: katalog dosyası yok: ${p} — önce build.mjs çalıştır`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (p, data) => {
  if (WRITE) fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
};

console.log(`— apply-to-backend ${WRITE ? '(YAZMA MODU)' : '(DRY-RUN — hiçbir dosya değişmez)'} —`);
console.log(`  Hedef: ${BACKEND}`);

let changedFiles = 0;

// --- 1) Flat listeler: yeniden yaz ------------------------------------------
const flatPlans = [
  ['stickers.json', 'stickers.json', s => ({ id: s.id, name: s.name, rarity: s.rarity, imageUrl: s.imageUrl })],
  ['keychains.json', 'keychains.json', s => ({ id: s.id, name: s.name, rarity: s.rarity, imageUrl: s.imageUrl })],
  ['musickits.json', 'musickits.json', s => ({ id: s.id, name: s.name, rarity: s.rarity, imageUrl: s.imageUrl, stattrak: s.stattrak, stattrak_only: s.stattrak_only })],
  ['collectibles.json', 'pins.json', s => ({ id: s.id, name: s.name, rarity: s.rarity, imageUrl: s.imageUrl, type: s.type, genuine: s.genuine })]
];
for (const [catFile, backendFile, project] of flatPlans) {
  const data = cat(catFile).map(project);
  const target = path.join(BACKEND, backendFile);
  const existing = fs.existsSync(target) ? readJson(target) : [];
  const oldById = new Map(existing.map(x => [String(x.id), x]));
  const newIds = new Set(data.map(x => String(x.id)));
  const added = data.filter(x => !oldById.has(String(x.id))).length;
  const removed = existing.filter(x => !newIds.has(String(x.id))).length;
  let fieldChanged = 0;
  for (const item of data) {
    const old = oldById.get(String(item.id));
    if (old && (old.name !== item.name || old.rarity !== item.rarity || old.imageUrl !== item.imageUrl)) fieldChanged++;
  }
  console.log(`  ${backendFile}: ${existing.length} → ${data.length} kayıt | yeni=${added} kalkan=${removed} alan-değişen=${fieldChanged}`);
  if (added || removed || fieldChanged || existing.length !== data.length) { save(target, data); changedFiles++; }
}

// --- 2) agents.json: yeniden yaz --------------------------------------------
{
  const data = cat('agents.json');
  const target = path.join(BACKEND, 'agents.json');
  const existing = fs.existsSync(target) ? readJson(target) : {};
  const flat = obj => {
    const m = new Map();
    for (const t of Object.values(obj || {})) for (const g of Object.values(t)) for (const s of g.skins || []) m.set(String(s.skinId), s);
    return m;
  };
  const oldA = flat(existing), newA = flat(data);
  let added = 0, rarityFixed = 0;
  for (const [id, s] of newA) {
    const o = oldA.get(id);
    if (!o) added++;
    else if (o.rarity !== s.rarity) rarityFixed++;
  }
  console.log(`  agents.json: ${oldA.size} → ${newA.size} agent | yeni=${added} rarity-düzelen=${rarityFixed}`);
  if (added || rarityFixed || oldA.size !== newA.size) { save(target, data); changedFiles++; }
}

// --- 3) weapons/knives/gloves: merge ----------------------------------------
const toBackendSkin = s => ({
  name: s.name,
  photo: s.photo,
  legacy_model: Boolean(s.legacy_model),
  skinId: String(s.skinId),
  rarity: s.rarity,
  imageUrl: s.imageUrl
});

function mergeInto(targetFile, catalogItems, nameField, extraEntryFields) {
  if (!fs.existsSync(targetFile)) throw new Error(`HATA: backend dosyası yok: ${targetFile}`);
  const data = readJson(targetFile);
  let addedSkins = 0, enrichedImg = 0, newItems = 0;

  for (const [key, catItem] of Object.entries(catalogItems)) {
    if (!data[key]) {
      const entry = { weaponIndex: catItem.weaponIndex, skins: catItem.skins.map(toBackendSkin), ...extraEntryFields(catItem) };
      data[key] = entry;
      newItems++;
      addedSkins += catItem.skins.length;
      continue;
    }
    const ours = data[key];
    const bySkinId = new Map((ours.skins || []).map(s => [String(s.skinId), s]));
    for (const s of catItem.skins) {
      const o = bySkinId.get(String(s.skinId));
      if (!o) {
        (ours.skins ||= []).push(toBackendSkin(s));
        addedSkins++;
      } else if (!o.imageUrl && s.imageUrl) {
        o.imageUrl = s.imageUrl;
        enrichedImg++;
      }
    }
  }
  const rel = path.relative(BACKEND, targetFile);
  console.log(`  ${rel}: yeni-item=${newItems} yeni-skin=${addedSkins} imageUrl-dolan=${enrichedImg}`);
  if (newItems || addedSkins || enrichedImg) { save(targetFile, data); changedFiles++; }
}

// weapons: class alanına göre 8 dosyaya dağıt
const weapons = cat('weapons.json');
const byClass = {};
for (const [key, item] of Object.entries(weapons)) {
  if (!item.class) throw new Error(`HATA: class alanı olmayan silah: ${key}`);
  (byClass[item.class] ||= {})[key] = item;
}
for (const [cls, items] of Object.entries(byClass)) {
  mergeInto(path.join(BACKEND, 'weapons', `${cls}.json`), items, 'weaponName',
    it => ({ team: it.team, weaponName: it.weaponName }));
}
mergeInto(path.join(BACKEND, 'knives.json'), cat('knives.json'), 'knifeName',
  it => ({ knifeName: it.knifeName }));
mergeInto(path.join(BACKEND, 'gloves.json'), cat('gloves.json'), 'gloveName',
  it => ({ gloveName: it.gloveName }));

console.log('');
console.log(WRITE
  ? `Tamam: ${changedFiles} dosya güncellendi.`
  : `DRY-RUN tamam: yazma modunda ${changedFiles} dosya değişecekti. Uygulamak için: node scripts/apply-to-backend.mjs --write`);
