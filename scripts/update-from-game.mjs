#!/usr/bin/env node
// ============================================================================
// serverskins-data — otomatik güncelleyici (TEK KOMUT, Valve-direkt)
// ----------------------------------------------------------------------------
// CS2 güncellemesi gelince:  node scripts/update-from-game.mjs
//
// TEK KAYNAK: Valve CS2 oyun dosyaları (SteamDatabase/GameTracking-CS2):
//   items_game.txt + csgo_english.txt + csgo_turkish.txt.
// Hiçbir üçüncü-taraf katalog/görsel aynası kullanılmaz.
//
// Akış:
//   [1] steam.inf → oyun sürümü; değişmediyse (ve --force yoksa) "güncel" der, çıkar.
//   [2] Ham Valve kaynakları indirilir: items_game.txt, csgo_english.txt,
//       csgo_turkish.txt (+ version.json).
//   [3] items_game.txt + csgo_*.txt KeyValues parse edilir → catalog/ üretilir
//       (silah/bıçak/eldiven/ajan/sticker/keychain/müzik/koleksiyon) +
//       catalog/names.tr.json (Türkçe isimler, csgo_turkish.txt'ten).
//       Görsel URL'leri: mevcut catalog/'daki gerçek URL'ler korunur; yeni item
//       için görsel yoksa imageUrl = null (GÖRÜNÜR eksik — sessiz fallback yok).
//       Silah/bıçak/eldiven mevcut katalog üzerine EKLEMELİ işlenir (hiçbir kayıt
//       silinmez); sticker/keychain/müzik/koleksiyon/ajan items_game'den bütün
//       olarak yeniden üretilir (bu tablolar oyunda eksiksizdir).
//   [4] Önceki catalog/ id'leriyle diff → yeni eklenen item'ler konsola.
//   [5] Değişiklik varsa git commit + push ("Auto-update: CS2 <sürüm>"),
//       yoksa "güncel". (--no-git ile atlanır; git yoksa GÖRÜNÜR hata verir.)
//
// Bağımlılık YOK (saf Node + yerel keyvalues.mjs). Sessiz fallback YOK:
// eşlenemeyen/rarity'siz/isimsiz kayıtlar raporda listelenir.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { parseKeyValues } from './keyvalues.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_GAME = path.join(ROOT, 'raw', 'game');
const CATALOG = path.join(ROOT, 'catalog');

const FORCE = process.argv.includes('--force');
const NO_GIT = process.argv.includes('--no-git');
const GIT = process.env.GIT_EXE || 'git';

// --- Kaynak URL'ler (yalnızca Valve / GameTracking-CS2) -----------------------
const GT = 'https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master';
const URLS = {
  steamInf: `${GT}/game/csgo/steam.inf`,
  itemsGame: `${GT}/game/csgo/pak01_dir/scripts/items/items_game.txt`,
  csgoEnglish: `${GT}/game/csgo/pak01_dir/resource/csgo_english.txt`,
  csgoTurkish: `${GT}/game/csgo/pak01_dir/resource/csgo_turkish.txt`
};

// --- Eşleme tabloları ---------------------------------------------------------
const RARITY_ITEM = {
  rarity_default: 'consumer', rarity_common: 'consumer', rarity_rare: 'milspec',
  rarity_mythical: 'restricted', rarity_legendary: 'classified',
  rarity_ancient: 'covert', rarity_contraband: 'contraband'
};
const RARITY_WEAPON_SUFFIX = { // client_loot_lists son eki -> bizim rarity
  common: 'common', uncommon: 'uncommon', rare: 'milspec', mythical: 'restricted',
  legendary: 'classified', ancient: 'covert'
};
const CANONICAL_TO_OURS = {
  weapon_sg556: 'weapon_sg553', weapon_bayonet: 'weapon_knife_bayonet',
  studded_bloodhound_gloves: 'bloodhound_gloves', studded_brokenfang_gloves: 'broken_fang_gloves',
  slick_gloves: 'driver_gloves', leather_handwraps: 'hand_wraps',
  studded_hydra_gloves: 'hydra_gloves', motorcycle_gloves: 'moto_gloves',
  sporty_gloves: 'sport_gloves'
};
const WEAPON_CLASS = {
  weapon_fiveseven: 'pistols', weapon_hkp2000: 'pistols', weapon_glock: 'pistols',
  weapon_tec9: 'pistols', weapon_usp_silencer: 'pistols',
  weapon_aug: 'rifles', weapon_famas: 'rifles', weapon_m4a1_silencer: 'rifles',
  weapon_m4a1: 'rifles', weapon_scar20: 'rifles', weapon_ak47: 'rifles',
  weapon_g3sg1: 'rifles', weapon_galilar: 'rifles', weapon_sg553: 'rifles',
  weapon_mp9: 'smgs', weapon_mac10: 'smgs', weapon_mp7: 'smgs',
  weapon_mag7: 'heavy', weapon_sawedoff: 'heavy',
  weapon_cz75a: 'common_pistols', weapon_deagle: 'common_pistols',
  weapon_elite: 'common_pistols', weapon_p250: 'common_pistols',
  weapon_revolver: 'common_pistols', weapon_taser: 'common_pistols',
  weapon_awp: 'common_rifles', weapon_ssg08: 'common_rifles',
  weapon_m249: 'common_rifles', weapon_negev: 'common_rifles',
  weapon_mp5sd: 'common_smgs', weapon_p90: 'common_smgs',
  weapon_bizon: 'common_smgs', weapon_ump45: 'common_smgs',
  weapon_nova: 'common_heavy', weapon_xm1014: 'common_heavy'
};
const AGENT_GROUPS = {
  tm_professional: { team: '2', group: 'the_professionals', agentName: 'The Professionals' },
  tm_balkan: { team: '2', group: 'sabre', agentName: 'Sabre' },
  tm_jungle_raider: { team: '2', group: 'guerrilla_warfare', agentName: 'Guerrilla Warfare' },
  tm_leet: { team: '2', group: 'elite_crew', agentName: 'Elite Crew' },
  tm_phoenix: { team: '2', group: 'phoenix', agentName: 'Phoenix' },
  ctm_st6: { team: '3', group: 'nswc_seal', agentName: 'NSWC SEAL' },
  ctm_swat: { team: '3', group: 'swat', agentName: 'SWAT' },
  ctm_gendarmerie: { team: '3', group: 'gendarmerie_nationale', agentName: 'Gendarmerie Nationale' },
  ctm_diver: { team: '3', group: 'seal_frogman', agentName: 'SEAL Frogman' },
  ctm_fbi: { team: '3', group: 'fbi', agentName: 'FBI SWAT' },
  ctm_sas: { team: '3', group: 'sas', agentName: 'SAS' }
};
const GLOVE_ITEMS = new Set(['studded_bloodhound_gloves', 'slick_gloves', 'leather_handwraps',
  'motorcycle_gloves', 'specialist_gloves', 'sporty_gloves', 'studded_hydra_gloves',
  'studded_brokenfang_gloves']);
// Oyunun belgelenmiş istisnaları (items_game davranışıyla birebir):
const STICKER_SKIP_IDS = new Set(['232', '234', '235', '236']); // DreamHack 2014'te hiç dağıtılmadı
const COLLECTIBLE_SKIP_IDS = new Set(['5180']); // Redacted Map Coin (Transit)
const MUSIC_STATTRAK_ONLY = new Set(['beartooth_02', 'blitzkids_01', 'hundredth_01',
  'neckdeep_01', 'roam_01', 'twinatlantic_01', 'skog_03']); // yalnız StatTrak satıldı
const RARITY_HARDCODED = { // oyunda sabit kodlu (loot list'te türetilemeyen) rarity'ler
  '[cu_m4a1_howling]weapon_m4a1': 'contraband',
  '[cu_retribution]weapon_elite': 'milspec',
  '[cu_mac10_decay]weapon_mac10': 'restricted',
  '[cu_p90_scorpius]weapon_p90': 'milspec',
  '[hy_labrat_mp5]weapon_mp5sd': 'restricted',
  '[cu_xray_p250]weapon_p250': 'restricted',
  '[cu_usp_spitfire]weapon_usp_silencer': 'classified',
  '[am_nitrogen]weapon_cz75a': 'milspec'
};

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HATA: indirilemedi (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf;
}

function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString('utf8');
  return buf.toString('utf8');
}

function parseSteamInf(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  if (!out.ClientVersion) throw new Error('HATA: steam.inf içinde ClientVersion yok');
  return out;
}

const writeJson = (p, data) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
};
const readJsonIf = p => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------

console.log('— serverskins-data otomatik güncelleyici (Valve-direkt) —');

// [1] Sürüm kontrolü
console.log('[1/5] Oyun sürümü kontrol ediliyor...');
const infBuf = await download(URLS.steamInf, path.join(RAW_GAME, 'steam.inf'));
const inf = parseSteamInf(decodeText(infBuf));
const version = {
  ClientVersion: inf.ClientVersion,
  ServerVersion: inf.ServerVersion ?? null,
  PatchVersion: inf.PatchVersion ?? null,
  VersionDate: inf.VersionDate ?? null,
  VersionTime: inf.VersionTime ?? null
};
console.log(`  CS2 sürümü: ${version.PatchVersion || version.ClientVersion} (${version.VersionDate || 'tarih yok'})`);

const prevVersion = readJsonIf(path.join(RAW_GAME, 'version.json'));
if (!FORCE && prevVersion && prevVersion.ClientVersion === version.ClientVersion) {
  console.log('  Sürüm değişmemiş — katalog GÜNCEL. (--force ile yine de üretebilirsin)');
  process.exit(0);
}

// [2] Ham Valve kaynakları
console.log('[2/5] Ham Valve kaynakları indiriliyor...');
const igBuf = await download(URLS.itemsGame, path.join(RAW_GAME, 'items_game.txt'));
console.log('  items_game.txt indi');
const engBuf = await download(URLS.csgoEnglish, path.join(RAW_GAME, 'csgo_english.txt'));
console.log('  csgo_english.txt indi');
const trBuf = await download(URLS.csgoTurkish, path.join(RAW_GAME, 'csgo_turkish.txt'));
console.log('  csgo_turkish.txt indi');
writeJson(path.join(RAW_GAME, 'version.json'), { ...version, fetched_at: new Date().toISOString() });

// meta.json güncelle (kaynak: Valve CS2 oyun dosyaları)
const prevMeta = readJsonIf(path.join(ROOT, 'raw', 'meta.json')) || {};
writeJson(path.join(ROOT, 'raw', 'meta.json'), {
  ...prevMeta,
  source: 'Valve CS2 game files',
  source_url: 'https://github.com/SteamDatabase/GameTracking-CS2',
  source_files: ['items_game.txt', 'csgo_english.txt', 'csgo_turkish.txt'],
  fetched_at: new Date().toISOString(),
  game_version: version
});

// Önceki catalog id'lerini yeni-item diff'i için sakla
function catalogIdSets() {
  const sets = {};
  for (const f of ['stickers', 'keychains', 'musickits', 'collectibles']) {
    const d = readJsonIf(path.join(CATALOG, `${f}.json`));
    sets[f] = new Set((d || []).map(x => String(x.id)));
  }
  for (const f of ['weapons', 'knives', 'gloves']) {
    const d = readJsonIf(path.join(CATALOG, `${f}.json`)) || {};
    sets[f] = new Set();
    for (const [k, v] of Object.entries(d)) for (const s of v.skins || []) sets[f].add(`${k}#${s.skinId}`);
  }
  const a = readJsonIf(path.join(CATALOG, 'agents.json')) || {};
  sets.agents = new Set();
  for (const t of Object.values(a)) for (const g of Object.values(t)) for (const s of g.skins || []) sets.agents.add(String(s.skinId));
  return sets;
}
const beforeIds = catalogIdSets();

// [3] catalog/ üretimi (Valve KeyValues)
console.log('[3/5] catalog/ üretiliyor (items_game.txt + csgo_*.txt)...');

const igRoot = parseKeyValues(decodeText(igBuf));
const ig = igRoot.items_game || igRoot;
if (!ig.items || !ig.paint_kits) throw new Error('HATA: items_game.txt beklenen yapıda değil (items/paint_kits yok)');

// İngilizce tokenlar
const engRoot = parseKeyValues(decodeText(engBuf));
const engTokens = engRoot.lang?.Tokens || engRoot.lang?.tokens;
if (!engTokens) throw new Error('HATA: csgo_english.txt beklenen yapıda değil (lang.Tokens yok)');
const EN = new Map(Object.entries(engTokens).map(([k, v]) => [k.toLowerCase(), v]));

// Türkçe tokenlar (Valve csgo_turkish.txt — csgo_english ile aynı KeyValues yapısı)
const trRoot = parseKeyValues(decodeText(trBuf));
const trTokens = trRoot.lang?.Tokens || trRoot.lang?.tokens;
if (!trTokens) throw new Error('HATA: csgo_turkish.txt beklenen yapıda değil (lang.Tokens yok)');
const TR = new Map(Object.entries(trTokens).map(([k, v]) => [k.toLowerCase(), v]));

const t = (map, token) => {
  if (!token) return null;
  const key = String(token).replace(/^#/, '').toLowerCase();
  return map.get(key) ?? null;
};

// --- Mevcut catalog/ görsellerini (gerçek Steam CDN URL'leri) koru ------------
const existing = {
  weapons: readJsonIf(path.join(CATALOG, 'weapons.json')) || {},
  knives: readJsonIf(path.join(CATALOG, 'knives.json')) || {},
  gloves: readJsonIf(path.join(CATALOG, 'gloves.json')) || {},
  agents: readJsonIf(path.join(CATALOG, 'agents.json')) || {},
  stickers: readJsonIf(path.join(CATALOG, 'stickers.json')) || [],
  keychains: readJsonIf(path.join(CATALOG, 'keychains.json')) || [],
  musickits: readJsonIf(path.join(CATALOG, 'musickits.json')) || [],
  collectibles: readJsonIf(path.join(CATALOG, 'collectibles.json')) || []
};
const imgIndex = { skins: new Map(), stickers: new Map(), keychains: new Map(), musickits: new Map(), collectibles: new Map(), agents: new Map() };
for (const bucket of ['weapons', 'knives', 'gloves']) {
  for (const [k, v] of Object.entries(existing[bucket])) {
    for (const s of v.skins || []) if (s.imageUrl) imgIndex.skins.set(`${k}#${s.skinId}`, s.imageUrl);
  }
}
for (const t2 of Object.values(existing.agents)) for (const g of Object.values(t2)) for (const s of g.skins || []) {
  if (s.imageUrl) imgIndex.agents.set(String(s.skinId), s.imageUrl);
}
for (const flat of ['stickers', 'keychains', 'musickits', 'collectibles']) {
  for (const s of existing[flat]) if (s.imageUrl) imgIndex[flat].set(String(s.id), s.imageUrl);
}
// Görsel: yalnızca daha önce çözülmüş gerçek URL korunur; yoksa null (görünür eksik)
const imgSkin = (ourKey, skinId) => imgIndex.skins.get(`${ourKey}#${skinId}`) ?? null;
const imgFlat = (kind, id) => imgIndex[kind].get(String(id)) ?? null;

// prefab zinciri (2 seviye)
const prefabs = {};
for (const [key, value] of Object.entries(ig.prefabs || {})) {
  const inner = ig.prefabs[value?.prefab] || {};
  prefabs[key] = {
    item_name: value.item_name ?? inner.item_name,
    used_by_classes: value.used_by_classes ?? inner.used_by_classes
  };
}
// items: name -> kayıt
const items = {};
for (const [objectId, value] of Object.entries(ig.items || {})) {
  if (!value?.name) continue;
  items[value.name] = {
    ...value,
    object_id: objectId,
    item_name_resolved: value.item_name ?? prefabs[value.prefab]?.item_name ?? null
  };
}
// paint kits: name(lowercase) -> kayıt
const paintKits = {};
for (const [idx, pk] of Object.entries(ig.paint_kits || {})) {
  if (!pk?.name || pk.description_tag === undefined) continue;
  paintKits[pk.name.toLowerCase()] = {
    paint_index: idx,
    name: pk.name,
    description_tag: pk.description_tag,
    wear_remap_min: pk.wear_remap_min !== undefined ? Number(pk.wear_remap_min) : 0.06,
    wear_remap_max: pk.wear_remap_max !== undefined ? Number(pk.wear_remap_max) : 0.8,
    legacy_model: pk.use_legacy_model === '1'
  };
}

// rarity haritası: "[paint]weapon" (lowercase) -> bizim rarity
const rarities = {};
for (const [k, v] of Object.entries(RARITY_HARDCODED)) rarities[k] = v;
for (const [listName, entries] of Object.entries(ig.client_loot_lists || {})) {
  const suffix = listName.split('_').pop();
  const our = RARITY_WEAPON_SUFFIX[suffix];
  if (!our) continue;
  for (const key of Object.keys(entries)) {
    if (key.includes('[')) rarities[key.toLowerCase()] = our;
  }
}

// koleksiyonlar: "[paint]weapon" (lowercase) -> [set adı EN]
const collectionsByKey = {};
for (const set of Object.values(ig.item_sets || {})) {
  const setName = t(EN, set.name);
  for (const key of Object.keys(set.items || {})) {
    const k = key.toLowerCase();
    (collectionsByKey[k] ||= []);
    if (setName) collectionsByKey[k].push(setName);
  }
}

// souvenir setleri: prefab'ında weapon_case_souvenirpkg olan itemların ItemSet'i
const souvenirSets = new Set();
for (const it of Object.values(items)) {
  if (String(it.prefab || '').includes('weapon_case_souvenirpkg')) {
    const setTag = it.tags?.ItemSet?.tag_value;
    if (setTag) souvenirSets.add(setTag);
  }
}
const souvenirKeys = new Set();
for (const [setKey, set] of Object.entries(ig.item_sets || {})) {
  if (souvenirSets.has(setKey.replace(/^set_/, '')) || souvenirSets.has(setKey)) {
    for (const key of Object.keys(set.items || {})) souvenirKeys.add(key.toLowerCase());
  }
}

// stattrak anahtarları (weapon_case içeren crate set'leri + iki sabit)
const stattrakKeys = new Set(['[cu_m4a1_howling]weapon_m4a1', '[cu_xray_p250]weapon_p250']);
{
  const crateSets = new Set();
  for (const it of Object.values(items)) {
    const prefab = String(it.prefab || '').split(' ');
    if (prefab.includes('weapon_case') || prefab.includes('volatile_pricing') || prefab.includes('volatile_pricing_gloves')) {
      const setTag = it.tags?.ItemSet?.tag_value;
      if (setTag) crateSets.add(setTag);
    }
  }
  for (const set of Object.values(ig.item_sets || {})) {
    if (!set.is_collection) continue;
    if (set.name === '#CSGO_set_dust_2_2021') continue;
    const bare = String(set.name || '').replace('#CSGO_', '');
    if (crateSets.has(bare)) {
      for (const key of Object.keys(set.items || {})) stattrakKeys.add(key.toLowerCase());
    }
  }
}

// Doppler fazı (paint adından)
function detectPhase(paintName) {
  const n = paintName.toLowerCase();
  const isFamily = n.includes('doppler') || n.includes('marbleized');
  if (!isFamily) return null;
  const m = n.match(/phase([1-4])/);
  if (m) return `Phase ${m[1]}`;
  if (n.includes('ruby')) return 'Ruby';
  if (n.includes('sapphire')) return 'Sapphire';
  if (n.includes('blackpearl') || n.includes('black_pearl')) return 'Black Pearl';
  if (n.includes('emerald')) return 'Emerald';
  return null;
}

const report = { unmatchedKeys: [], missingRarity: [], missingName: [] };
const trNames = { skins: {}, stickers: {}, keychains: {}, musickits: {}, collectibles: {}, agents: {} };

// --- Silah/bıçak/eldiven: mevcut katalog üzerine EKLEMELİ --------------------
// Kaynak kombinasyon evreni: items_game client_loot_lists + item_sets içindeki
// tüm "[paint]item" anahtarları (oyunda dağıtılan/dağıtılmış skinler). Mevcut
// katalogdaki hiçbir kayıt silinmez; yalnızca eksik olanlar eklenir.
const weaponsOut = JSON.parse(JSON.stringify(existing.weapons));
const knivesOut = JSON.parse(JSON.stringify(existing.knives));
const glovesOut = JSON.parse(JSON.stringify(existing.gloves));

const skinKeys = new Map(); // lootKey(lower) -> { paintName, itemName }
const addKey = raw => {
  const key = String(raw).toLowerCase();
  const m = key.match(/^\[([^\]]+)\](.+)$/);
  if (m) skinKeys.set(key, { paintName: m[1], itemName: m[2] });
};
for (const entries of Object.values(ig.client_loot_lists || {})) {
  for (const k of Object.keys(entries)) if (k.includes('[')) addKey(k);
}
for (const set of Object.values(ig.item_sets || {})) {
  for (const k of Object.keys(set.items || {})) if (k.includes('[')) addKey(k);
}

for (const [lootKey, { paintName, itemName }] of skinKeys) {
  const pk = paintKits[paintName];
  const item = items[itemName];
  if (!pk || !item) { report.unmatchedKeys.push(lootKey); continue; }

  const ourKey = CANONICAL_TO_OURS[itemName] || itemName;
  const isKnife = itemName.includes('knife') || itemName === 'weapon_bayonet';
  const isGlove = GLOVE_ITEMS.has(itemName);
  const bucket = isKnife ? knivesOut : (isGlove ? glovesOut : weaponsOut);

  if (!bucket[ourKey]) {
    const displayName = t(EN, item.item_name_resolved) || null;
    if (!displayName) report.missingName.push(itemName);
    const entry = { weaponIndex: Number(item.object_id), skins: [] };
    if (isKnife) entry.knifeName = displayName;
    else if (isGlove) entry.gloveName = displayName;
    else {
      const ubc = item.used_by_classes || prefabs[item.prefab]?.used_by_classes || {};
      const hasT = ubc.terrorists === '1', hasCT = ubc['counter-terrorists'] === '1';
      entry.team = hasT && hasCT ? 0 : (hasT ? 2 : (hasCT ? 3 : 0));
      entry.weaponName = displayName;
      entry.class = WEAPON_CLASS[ourKey] || null;
      if (!entry.class) report.missingName.push(`SINIFSIZ SİLAH: ${ourKey}`);
    }
    bucket[ourKey] = entry;
  }

  const skinId = String(pk.paint_index);
  // Zaten katalogda varsa (mevcut kayıt) DOKUNMA — sadece TR ismini üretmeye çalış.
  const already = (bucket[ourKey].skins || []).some(s => String(s.skinId) === skinId);

  let rarity;
  if (isKnife || isGlove) rarity = 'gold';
  else {
    rarity = rarities[lootKey];
    if (!rarity) { if (!already) report.missingRarity.push(lootKey); continue; }
  }

  const phase = detectPhase(paintName);
  let skinName = t(EN, pk.description_tag);
  if (!skinName && !already) { report.missingName.push(pk.description_tag); }
  if (phase && skinName) skinName = `${skinName} (${phase})`;
  const skinNameTr = t(TR, pk.description_tag);
  if (skinNameTr) trNames.skins[`${ourKey}#${skinId}`] = phase ? `${skinNameTr} (${phase})` : skinNameTr;

  if (already) continue;
  if (!skinName) continue; // isimsiz yeni skin eklenmez (raporda listelendi)

  bucket[ourKey].skins.push({
    name: skinName,
    photo: `${ourKey}_${pk.name}.png`,
    legacy_model: pk.legacy_model,
    skinId,
    rarity,
    imageUrl: imgSkin(ourKey, skinId),
    pattern: pk.name,
    min_float: pk.wear_remap_min,
    max_float: pk.wear_remap_max,
    stattrak: stattrakKeys.has(lootKey),
    souvenir: souvenirKeys.has(lootKey),
    phase,
    collections: (collectionsByKey[lootKey] || []).slice(0, 3)
  });
}

// Default (skinId 0) girdileri eksikse ekle (görsel mevcut katalogdan korunur)
for (const [ourKey, entry] of Object.entries({ ...weaponsOut, ...knivesOut })) {
  if ((entry.skins || []).some(s => String(s.skinId) === '0')) continue;
  entry.skins.unshift({
    name: 'Default',
    photo: `${ourKey}_default.png`,
    legacy_model: false,
    skinId: '0',
    rarity: 'default',
    imageUrl: imgSkin(ourKey, '0'),
    pattern: null, min_float: 0, max_float: 1,
    stattrak: false, souvenir: false, phase: null, collections: []
  });
}
for (const bucket of [weaponsOut, knivesOut, glovesOut]) {
  for (const e of Object.values(bucket)) e.skins.sort((a, b) => parseInt(a.skinId) - parseInt(b.skinId));
}

// --- Stickers (items_game.txt'ten bütün olarak) ------------------------------
const stickersOut = [];
for (const [objectId, kit] of Object.entries(ig.sticker_kits || {})) {
  const item = { ...kit, object_id: objectId };
  if (item.sticker_material === undefined) continue;
  if (item.sticker_material.startsWith('team_roles_capsule') && item.sticker_material.endsWith('_foil')
    && item.sticker_material !== 'team_roles_capsule/pro_foil') continue;
  if (STICKER_SKIP_IDS.has(objectId)) continue;
  if (!String(item.item_name || '').toLowerCase().includes('stickerkit_')) continue;
  if (String(item.name || '').includes('graffiti')) continue;
  if (String(item.name || '').includes('spray_')) continue;

  if (item.name === 'comm01_howling_dawn') item.item_rarity = 'contraband'; // oyun düzeltmesi
  let nameToken = item.item_name;
  if (nameToken === '#StickerKit_dhw2014_dignitas_gold') nameToken = '#StickerKit_dhw2014_teamdignitas_gold';

  const name = t(EN, nameToken);
  if (!name) { report.missingName.push(nameToken); continue; }
  const rarityId = item.item_rarity ? `rarity_${item.item_rarity}` : 'rarity_default';
  const rarity = RARITY_ITEM[rarityId];
  if (!rarity) { report.missingRarity.push(`sticker ${objectId} ${rarityId}`); continue; }

  const id = Number(objectId);
  stickersOut.push({ id, name, rarity, imageUrl: imgFlat('stickers', id) });
  const nameTr = t(TR, nameToken);
  if (nameTr) trNames.stickers[objectId] = nameTr;
}
stickersOut.sort((a, b) => a.id - b.id);

// --- Keychains ---------------------------------------------------------------
const keychainsOut = [];
for (const [objectId, kc] of Object.entries(ig.keychain_definitions || {})) {
  // Turnuva highlight (item_quality=tournament) ve Sticker Slab (customized) hariç.
  if (kc.item_quality === 'tournament' || kc.item_quality === 'customized') continue;
  const nameToken = kc.loc_name;
  const name = t(EN, nameToken);
  if (!name) { report.missingName.push(`keychain ${objectId} ${nameToken}`); continue; }
  const rarityId = `rarity_${kc.item_rarity}`;
  const rarity = RARITY_ITEM[rarityId];
  if (!rarity) { report.missingRarity.push(`keychain ${objectId} ${rarityId}`); continue; }
  const id = Number(objectId);
  keychainsOut.push({ id, name, rarity, imageUrl: imgFlat('keychains', id) });
  const nameTr = t(TR, nameToken);
  if (nameTr) trNames.keychains[objectId] = nameTr;
}
keychainsOut.sort((a, b) => a.id - b.id);

// --- Music kits --------------------------------------------------------------
const musicOut = [];
for (const [objectId, md] of Object.entries(ig.music_definitions || {})) {
  let m = { ...md };
  if (m.name === 'valve_02') m.loc_name = '#musickit_valve_csgo_01'; // valve_01 ile mükerrer
  const name = t(EN, m.loc_name);
  if (!name) { report.missingName.push(`musickit ${objectId} ${m.loc_name}`); continue; }
  const stattrak = t(EN, `coupon_musickit_${m.name}_stattrak`) !== null || MUSIC_STATTRAK_ONLY.has(m.name);
  const id = Number(objectId);
  musicOut.push({
    id, name, rarity: 'milspec',
    imageUrl: imgFlat('musickits', id),
    stattrak,
    stattrak_only: MUSIC_STATTRAK_ONLY.has(m.name)
  });
  const nameTr = t(TR, m.loc_name);
  if (nameTr) trNames.musickits[objectId] = nameTr;
}
musicOut.sort((a, b) => a.id - b.id);

// --- Collectibles ------------------------------------------------------------
const collectiblesOut = [];
for (const it of Object.values(items)) {
  const nameToken = it.item_name_resolved;
  if (!nameToken) continue;
  if (COLLECTIBLE_SKIP_IDS.has(it.object_id)) continue;
  const isColl = nameToken.startsWith('#CSGO_Collectible') || nameToken.startsWith('#CSGO_TournamentJournal')
    || nameToken.startsWith('#CSGO_TournamentPass') || nameToken.startsWith('#CSGO_Ticket_');
  if (!isColl) continue;

  const inv = String(it.image_inventory || '');
  let type = null;
  if (inv.includes('service_medal')) type = 'Service Medal';
  else if (nameToken.startsWith('#CSGO_Collectible_Map')) type = 'Map Contributor Coin';
  else if (nameToken.startsWith('#CSGO_TournamentJournal')) type = "Pick'Em Coin";
  else if (nameToken.startsWith('#CSGO_Collectible_Pin')) type = 'Pin';
  else if (nameToken.startsWith('#CSGO_TournamentPass') && nameToken.endsWith('_charge')) type = 'Souvenir Token';
  else if (nameToken.startsWith('#CSGO_TournamentPass')) type = 'Tournament Pass';
  else if (nameToken.startsWith('#CSGO_Ticket_')) type = 'Operation Pass';
  else if (nameToken.startsWith('#CSGO_Collectible_CommunitySeason')) {
    type = it.prefab === 'valve season_tiers' ? 'Stars for Operation' : 'Operation Coin';
  } else if (it.attributes?.['tournament event id'] !== undefined) {
    if (nameToken.includes('PickEm')) type = "Old Pick'Em Trophy";
    else if (nameToken.includes('Fantasy')) type = 'Fantasy Trophy';
    else type = 'Tournament Finalist Trophy';
  } else if (it.prefab === 'premier_season_coin') type = 'Premier Season Coin';

  let rarityId = it.item_rarity ? `rarity_${it.item_rarity}` : null;
  if (!rarityId && it.prefab) {
    for (const key of String(it.prefab).split(' ')) {
      if (key.endsWith('_tournament_pass_prefab')) { rarityId = 'rarity_common'; break; }
      if (key.endsWith('_tournament_journal_prefab')) { rarityId = 'rarity_ancient'; break; }
      if (['season_pass', 'season_tiers'].includes(key)) { rarityId = 'rarity_common'; break; }
      if (['collectible_untradable_coin', 'majors_trophy', 'map_token', 'pickem_trophy', 'prestige_coin',
        'premier_season_coin', ...Array.from({ length: 11 }, (_, i) => `season${i + 1}_coin`)].includes(key)) {
        rarityId = 'rarity_ancient'; break;
      }
    }
  }
  if (!rarityId) { report.missingRarity.push(`collectible ${it.object_id} (${nameToken})`); continue; }
  const rarity = RARITY_ITEM[rarityId];
  if (!rarity) { report.missingRarity.push(`collectible ${it.object_id} ${rarityId}`); continue; }

  const genuine = it.prefab === 'attendance_pin';
  let name = t(EN, nameToken);
  if (!name) { report.missingName.push(nameToken); continue; }
  if (genuine) name = `${t(EN, 'genuine') || 'Genuine'} ${name}`;

  const id = Number(it.object_id);
  collectiblesOut.push({
    id, name, rarity,
    imageUrl: imgFlat('collectibles', id),
    type: type || 'Collectible',
    genuine
  });
  const nameTr = t(TR, nameToken);
  if (nameTr) trNames.collectibles[it.object_id] = genuine ? `${t(TR, 'genuine') || 'Genuine'} ${nameTr}` : nameTr;
}
collectiblesOut.sort((a, b) => a.id - b.id);

// --- Agents ------------------------------------------------------------------
const agentsOut = { 2: {}, 3: {} };
for (const it of Object.values(items)) {
  if (!String(it.name || '').startsWith('customplayer_')) continue;
  const modelPlayer = it.model_player;
  if (!modelPlayer) { report.missingName.push(`agent ${it.name}: model_player yok`); continue; }
  const parts = modelPlayer.replace(/\.vmdl$/, '').split('/');
  const model = parts.slice(-2).join('/');
  const folder = parts[parts.length - 2];
  const grp = AGENT_GROUPS[folder];
  if (!grp) { report.missingName.push(`agent ${it.name}: bilinmeyen klasör ${folder} — AGENT_GROUPS tablosuna eklenmeli`); continue; }
  const name = t(EN, it.item_name_resolved);
  if (!name) { report.missingName.push(`agent ${it.name} ${it.item_name_resolved}`); continue; }
  const rarityId = `rarity_${it.item_rarity}`;
  const rarity = ({ rarity_rare: 'milspec', rarity_mythical: 'restricted', rarity_legendary: 'classified', rarity_ancient: 'covert' })[rarityId];
  if (!rarity) { report.missingRarity.push(`agent ${it.object_id} ${rarityId}`); continue; }
  if (!agentsOut[grp.team][grp.group]) agentsOut[grp.team][grp.group] = { agentName: grp.agentName, skins: [] };
  agentsOut[grp.team][grp.group].skins.push({
    name,
    photo: `${it.object_id}.png`,
    model,
    skinId: Number(it.object_id),
    rarity,
    imageUrl: imgFlat('agents', it.object_id)
  });
  const nameTr = t(TR, it.item_name_resolved);
  if (nameTr) trNames.agents[it.object_id] = nameTr;
}
for (const teamObj of Object.values(agentsOut)) {
  for (const g of Object.values(teamObj)) g.skins.sort((x, y) => x.skinId - y.skinId);
}

// --- catalog/ yaz ------------------------------------------------------------
fs.mkdirSync(CATALOG, { recursive: true });
const counts = {};
const writeOut = (name, data) => {
  writeJson(path.join(CATALOG, name), data);
  counts[name] = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`  catalog/${name}: ${counts[name]} kayıt`);
};
writeOut('weapons.json', weaponsOut);
writeOut('knives.json', knivesOut);
writeOut('gloves.json', glovesOut);
writeOut('agents.json', agentsOut);
writeOut('stickers.json', stickersOut);
writeOut('keychains.json', keychainsOut);
writeOut('musickits.json', musicOut);
writeOut('collectibles.json', collectiblesOut);
writeOut('names.tr.json', trNames);

// Görselsiz (imageUrl=null) kayıt sayısı — görünür rapor
let noImage = 0;
for (const b of [weaponsOut, knivesOut, glovesOut]) for (const e of Object.values(b)) for (const s of e.skins) if (!s.imageUrl) noImage++;
for (const a of [stickersOut, keychainsOut, musicOut, collectiblesOut]) for (const s of a) if (!s.imageUrl) noImage++;
for (const tm of Object.values(agentsOut)) for (const g of Object.values(tm)) for (const s of g.skins) if (!s.imageUrl) noImage++;

writeJson(path.join(CATALOG, 'index.json'), {
  generated_at: new Date().toISOString(),
  source: readJsonIf(path.join(ROOT, 'raw', 'meta.json')),
  files: counts,
  warnings: {
    unmatchedKeys: report.unmatchedKeys.length,
    missingRarity: report.missingRarity.length,
    missingName: report.missingName.length,
    imageUrlNull: noImage
  }
});
if (report.unmatchedKeys.length || report.missingRarity.length || report.missingName.length || noImage) {
  console.log(`  UYARI: eşlenemeyen=${report.unmatchedKeys.length}, rarity'siz=${report.missingRarity.length}, isimsiz=${report.missingName.length}, görselsiz=${noImage} (detay: catalog/build-warnings.json)`);
  writeJson(path.join(CATALOG, 'build-warnings.json'), report);
}

// [4] Yeni eklenen itemler (önceki catalog/ ile diff)
console.log('[4/5] Yeni itemler:');
const afterIds = catalogIdSets();
let anyNew = false;
for (const [cat, after] of Object.entries(afterIds)) {
  const before = beforeIds[cat] || new Set();
  const added = [...after].filter(x => !before.has(x));
  if (added.length) {
    anyNew = true;
    console.log(`  ${cat}: +${added.length} → ${added.slice(0, 15).join(', ')}${added.length > 15 ? ' ...' : ''}`);
  }
}
if (!anyNew) console.log('  (yeni item yok)');

// [5] git commit + push
if (NO_GIT) {
  console.log('[5/5] --no-git verildi, commit/push atlandı.');
} else {
  console.log('[5/5] git commit + push...');
  const run = args => spawnSync(GIT, args, { cwd: ROOT, encoding: 'utf8' });
  const ver = run(['--version']);
  if (ver.error || ver.status !== 0) {
    throw new Error(`HATA: git çalıştırılamadı ('${GIT}'). Git kur veya GIT_EXE ortam değişkeniyle yol ver ya da --no-git kullan.`);
  }
  const status = run(['status', '--porcelain']);
  if (status.status !== 0) throw new Error(`HATA: git status başarısız: ${status.stderr}`);
  if (!status.stdout.trim()) {
    console.log('  Değişiklik yok — repo GÜNCEL.');
  } else {
    const label = `CS2 ${version.PatchVersion || version.ClientVersion} (${version.VersionDate || ''})`.trim();
    let r = run(['add', '-A']);
    if (r.status !== 0) throw new Error(`HATA: git add: ${r.stderr}`);
    r = run(['commit', '-m', `Auto-update: ${label}`]);
    if (r.status !== 0) throw new Error(`HATA: git commit: ${r.stderr || r.stdout}`);
    r = run(['push']);
    if (r.status !== 0) throw new Error(`HATA: git push: ${r.stderr || r.stdout}`);
    console.log(`  Push edildi: "Auto-update: ${label}"`);
  }
}
console.log('Tamam.');
