#!/usr/bin/env node
// ============================================================================
// serverskins-data — otomatik güncelleyici (TEK KOMUT)
// ----------------------------------------------------------------------------
// CS2 güncellemesi gelince:  node scripts/update-from-game.mjs
//
// Akış:
//   [1] SteamDatabase/GameTracking-CS2 steam.inf → oyun sürümü; değişmediyse
//       (ve --force yoksa) "güncel" deyip çıkar.
//   [2] Ham kaynakları indirir:
//         raw/game/ : items_game.txt, csgo_english.txt (GameTracking-CS2),
//                     csgo_turkish.json (counter-strike-file-tracker),
//                     images.json + default_generated.json (counter-strike-image-tracker),
//                     version.json (steam.inf özeti)
//         raw/en/   : ByMykel/CSGO-API snapshot yenilenir (birincil kaynak)
//   [3] scripts/build.mjs çalıştırılır → catalog/ (ByMykel'den, birincil)
//   [4] items_game.txt + csgo_english.txt KeyValues parse edilir →
//       catalog-game/ (Valve verisinden BAĞIMSIZ ikincil üretim, aynı şema)
//       + catalog-game/names.tr.json (Türkçe isimler, csgo_turkish.json'dan)
//   [5] catalog/ ile catalog-game/ tutarlılık raporu →
//       catalog-game/consistency-report.json + konsol özeti
//   [6] Yeni eklenen itemler konsola listelenir (önceki catalog/ id'leriyle diff)
//   [7] Değişiklik varsa git commit + push ("Auto-update: CS2 <sürüm>"),
//       yoksa "güncel". (--no-git ile atlanır; git yoksa GÖRÜNÜR hata verir)
//
// Bağımlılık YOK. Sessiz fallback YOK: eşlenemeyen kayıtlar raporda listelenir.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { parseKeyValues } from './keyvalues.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_GAME = path.join(ROOT, 'raw', 'game');
const RAW_EN = path.join(ROOT, 'raw', 'en');
const CATALOG = path.join(ROOT, 'catalog');
const OUT = path.join(ROOT, 'catalog-game');

const FORCE = process.argv.includes('--force');
const NO_GIT = process.argv.includes('--no-git');
const GIT = process.env.GIT_EXE || 'git';

// --- Kaynak URL'ler -----------------------------------------------------------
const GT = 'https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master';
const URLS = {
  steamInf: `${GT}/game/csgo/steam.inf`,
  itemsGame: `${GT}/game/csgo/pak01_dir/scripts/items/items_game.txt`,
  csgoEnglish: `${GT}/game/csgo/pak01_dir/resource/csgo_english.txt`,
  csgoTurkish: 'https://raw.githubusercontent.com/ByMykel/counter-strike-file-tracker/main/static/csgo_turkish.json',
  imagesJson: 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/images.json',
  defaultGenerated: 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/default_generated.json'
};
const IMG_TRACKER = 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images';
const BYMYKEL = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en';
const BYMYKEL_FILES = ['skins.json', 'skins_not_grouped.json', 'stickers.json', 'keychains.json',
  'agents.json', 'music_kits.json', 'collectibles.json', 'crates.json', 'base_weapons.json'];

// --- build.mjs ile paylaşılan eşleme tabloları --------------------------------
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
// ByMykel'in belgelenmiş istisnaları (kaynak: services/*.js):
const STICKER_SKIP_IDS = new Set(['232', '234', '235', '236']); // DreamHack 2014'te hiç dağıtılmayanlar
const COLLECTIBLE_SKIP_IDS = new Set(['5180']); // Redacted Map Coin (Transit)
const MUSIC_STATTRAK_ONLY = new Set(['beartooth_02', 'blitzkids_01', 'hundredth_01',
  'neckdeep_01', 'roam_01', 'twinatlantic_01', 'skog_03']); // yalnız StatTrak satıldı
const RARITY_HARDCODED = { // ByMykel loadRarities hardCoded ile birebir
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

console.log('— serverskins-data otomatik güncelleyici —');

// [1] Sürüm kontrolü
console.log('[1/7] Oyun sürümü kontrol ediliyor...');
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

// [2] Kaynaklar
console.log('[2/7] Ham kaynaklar indiriliyor...');
const igBuf = await download(URLS.itemsGame, path.join(RAW_GAME, 'items_game.txt'));
console.log('  items_game.txt indi');
const engBuf = await download(URLS.csgoEnglish, path.join(RAW_GAME, 'csgo_english.txt'));
console.log('  csgo_english.txt indi');
const trBuf = await download(URLS.csgoTurkish, path.join(RAW_GAME, 'csgo_turkish.json'));
console.log('  csgo_turkish.json indi');
const imagesBuf = await download(URLS.imagesJson, path.join(RAW_GAME, 'images.json'));
console.log('  images.json indi');
const dgBuf = await download(URLS.defaultGenerated, path.join(RAW_GAME, 'default_generated.json'));
console.log('  default_generated.json indi');
for (const f of BYMYKEL_FILES) {
  await download(`${BYMYKEL}/${f}`, path.join(RAW_EN, f));
}
console.log(`  ByMykel snapshot yenilendi (${BYMYKEL_FILES.length} dosya)`);
writeJson(path.join(RAW_GAME, 'version.json'), { ...version, fetched_at: new Date().toISOString() });

// meta.json güncelle (ByMykel commit sha — alınamazsa null + görünür uyarı)
let bymykelSha = null, bymykelDate = null;
try {
  const r = await fetch('https://api.github.com/repos/ByMykel/CSGO-API/commits/main', {
    headers: { 'User-Agent': 'serverskins-data' }
  });
  if (r.ok) { const c = await r.json(); bymykelSha = c.sha; bymykelDate = c.commit?.committer?.date ?? null; }
} catch { /* aşağıda uyarı */ }
if (!bymykelSha) console.log('  UYARI: ByMykel commit sha alınamadı (GitHub API) — meta.source_commit=null yazılıyor');
const prevMeta = readJsonIf(path.join(ROOT, 'raw', 'meta.json')) || {};
writeJson(path.join(ROOT, 'raw', 'meta.json'), {
  ...prevMeta,
  source: 'ByMykel/CSGO-API',
  source_url: 'https://github.com/ByMykel/CSGO-API',
  source_commit: bymykelSha,
  source_commit_date: bymykelDate,
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

// [3] Birincil katalog (ByMykel) yeniden üret
console.log('[3/7] catalog/ yeniden üretiliyor (build.mjs, ByMykel birincil)...');
const buildRes = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { stdio: 'inherit' });
if (buildRes.status !== 0) throw new Error('HATA: build.mjs başarısız — üretim durduruldu');

// [4] Bağımsız ikincil üretim (items_game + csgo_english)
console.log('[4/7] catalog-game/ üretiliyor (Valve verisinden bağımsız)...');

const igRoot = parseKeyValues(decodeText(igBuf));
const ig = igRoot.items_game || igRoot;
if (!ig.items || !ig.paint_kits) throw new Error('HATA: items_game.txt beklenen yapıda değil (items/paint_kits yok)');

// İngilizce tokenlar
const engRoot = parseKeyValues(decodeText(engBuf));
const engTokens = engRoot.lang?.Tokens || engRoot.lang?.tokens;
if (!engTokens) throw new Error('HATA: csgo_english.txt beklenen yapıda değil (lang.Tokens yok)');
const EN = new Map(Object.entries(engTokens).map(([k, v]) => [k.toLowerCase(), v]));

// Türkçe tokenlar (file-tracker JSON formatı)
const trJson = JSON.parse(decodeText(trBuf));
const trTokens = trJson.lang?.Tokens || trJson.lang?.tokens || trJson.Tokens || trJson.tokens;
if (!trTokens) throw new Error('HATA: csgo_turkish.json beklenen yapıda değil');
const TR = new Map(Object.entries(trTokens).map(([k, v]) => [k.toLowerCase(), v]));

const t = (map, token) => {
  if (!token) return null;
  const key = String(token).replace(/^#/, '').toLowerCase();
  return map.get(key) ?? null;
};

const cdnImages = JSON.parse(decodeText(imagesBuf));
const img = p => {
  if (!p) return null;
  const key = p.toLowerCase();
  return cdnImages[key] ?? `${IMG_TRACKER}/${key}_png.png`;
};

// prefab zinciri (2 seviye — ByMykel loadPrefabs ile aynı)
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
const rarities = { };
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

// stattrak: ByMykel loadStattrakSkins portu
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

// Doppler fazı (paint adından — yalnız doppler/marbleized ailesi)
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

// --- Silah/bıçak/eldiven üretimi (default_generated ikon listesinden) --------
const report = { unmatchedIcons: [], missingRarity: [], missingName: [], skippedChicken: 0 };

const defaultGenerated = JSON.parse(decodeText(dgBuf));
// Aday item adları (uzun ad önce eşleşsin diye uzunluğa göre sıralı)
const wearableNames = Object.keys(items)
  .filter(n => n.startsWith('weapon_') || GLOVE_ITEMS.has(n))
  .sort((a, b) => b.length - a.length);

const weaponsOut = {}, knivesOut = {}, glovesOut = {};
const trNames = { skins: {}, stickers: {}, keychains: {}, musickits: {}, collectibles: {}, agents: {} };

for (const file of defaultGenerated) {
  if (!file.endsWith('_light_png.png')) continue;
  if (file.includes('pet_hen_1_hen')) { report.skippedChicken++; continue; }
  const base = file.replace('_light_png.png', '');

  const itemName = wearableNames.find(n => base.startsWith(n + '_'));
  if (!itemName) { report.unmatchedIcons.push(file); continue; }
  const paintName = base.slice(itemName.length + 1).toLowerCase();
  const pk = paintKits[paintName];
  if (!pk) { report.unmatchedIcons.push(file); continue; }

  const item = items[itemName];
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

  const lootKey = `[${paintName}]${itemName}`.toLowerCase();
  let rarity;
  if (isKnife || isGlove) rarity = 'gold';
  else {
    rarity = rarities[lootKey];
    if (!rarity) { report.missingRarity.push(lootKey); continue; }
  }

  const phase = detectPhase(paintName);
  let skinName = t(EN, pk.description_tag);
  if (!skinName) { report.missingName.push(pk.description_tag); skinName = null; }
  const skinNameTr = t(TR, pk.description_tag);
  if (phase && skinName) skinName = `${skinName} (${phase})`;

  const iconPath = `econ/default_generated/${base}`;
  const skinId = String(pk.paint_index);
  bucket[ourKey].skins.push({
    name: skinName,
    photo: `${ourKey}_${pk.name}.png`,
    legacy_model: pk.legacy_model,
    skinId,
    rarity,
    imageUrl: img(iconPath),
    pattern: pk.name,
    min_float: pk.wear_remap_min,
    max_float: pk.wear_remap_max,
    stattrak: stattrakKeys.has(lootKey),
    souvenir: souvenirKeys.has(lootKey),
    phase,
    collections: (collectionsByKey[lootKey] || []).slice(0, 3)
  });
  if (skinNameTr) trNames.skins[`${ourKey}#${skinId}`] = phase ? `${skinNameTr} (${phase})` : skinNameTr;
}

// Default girdileri
for (const [ourKey, entry] of Object.entries({ ...weaponsOut, ...knivesOut })) {
  const canonical = Object.entries(CANONICAL_TO_OURS).find(([, v]) => v === ourKey)?.[0] || ourKey;
  entry.skins.unshift({
    name: 'Default',
    photo: `${ourKey}_default.png`,
    legacy_model: false,
    skinId: '0',
    rarity: 'default',
    imageUrl: img(`econ/weapons/base_weapons/${canonical}`),
    pattern: null, min_float: 0, max_float: 1,
    stattrak: false, souvenir: false, phase: null, collections: []
  });
}
for (const bucket of [weaponsOut, knivesOut, glovesOut]) {
  for (const e of Object.values(bucket)) e.skins.sort((a, b) => parseInt(a.skinId) - parseInt(b.skinId));
}

// --- Stickers ---------------------------------------------------------------
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

  if (item.name === 'comm01_howling_dawn') item.item_rarity = 'contraband'; // ByMykel düzeltmesi
  let nameToken = item.item_name;
  if (nameToken === '#StickerKit_dhw2014_dignitas_gold') nameToken = '#StickerKit_dhw2014_teamdignitas_gold';

  const name = t(EN, nameToken);
  if (!name) { report.missingName.push(nameToken); continue; }
  const rarityId = item.item_rarity ? `rarity_${item.item_rarity}` : 'rarity_default';
  const rarity = RARITY_ITEM[rarityId];
  if (!rarity) { report.missingRarity.push(`sticker ${objectId} ${rarityId}`); continue; }

  stickersOut.push({
    id: Number(objectId), name, rarity,
    imageUrl: img(`econ/stickers/${item.sticker_material.toLowerCase()}`)
  });
  const nameTr = t(TR, nameToken);
  if (nameTr) trNames.stickers[objectId] = nameTr;
}
stickersOut.sort((a, b) => a.id - b.id);

// --- Keychains ---------------------------------------------------------------
const keychainsOut = [];
for (const [objectId, kc] of Object.entries(ig.keychain_definitions || {})) {
  // Turnuva highlight charm'ları (item_quality=tournament) ve Sticker Slab
  // (item_quality=customized) charm kataloğuna girmez — ByMykel de bunları
  // keychains.json yerine highlights/stickerSlabs olarak ayrı yayınlar.
  if (kc.item_quality === 'tournament' || kc.item_quality === 'customized') continue;
  const nameToken = kc.loc_name;
  const name = t(EN, nameToken);
  if (!name) { report.missingName.push(`keychain ${objectId} ${nameToken}`); continue; }
  const rarityId = `rarity_${kc.item_rarity}`;
  const rarity = RARITY_ITEM[rarityId];
  if (!rarity) { report.missingRarity.push(`keychain ${objectId} ${rarityId}`); continue; }
  const imageInv = (kc.image_inventory ?? ig.keychain_definitions[kc.base]?.image_inventory ?? '').toLowerCase();
  keychainsOut.push({ id: Number(objectId), name, rarity, imageUrl: imageInv ? img(imageInv) : null });
  const nameTr = t(TR, nameToken);
  if (nameTr) trNames.keychains[objectId] = nameTr;
}
keychainsOut.sort((a, b) => a.id - b.id);

// --- Music kits ---------------------------------------------------------------
const musicOut = [];
for (const [objectId, md] of Object.entries(ig.music_definitions || {})) {
  let m = { ...md };
  if (m.name === 'valve_02') { // ByMykel/Valve mükerrer kaydı: valve_01 ile aynı içerik
    m.loc_name = '#musickit_valve_csgo_01';
  }
  const name = t(EN, m.loc_name);
  if (!name) { report.missingName.push(`musickit ${objectId} ${m.loc_name}`); continue; }
  const stattrak = t(EN, `coupon_musickit_${m.name}_stattrak`) !== null
    || MUSIC_STATTRAK_ONLY.has(m.name);
  musicOut.push({
    id: Number(objectId), name, rarity: 'milspec',
    imageUrl: img(String(m.image_inventory || '').toLowerCase()),
    stattrak,
    stattrak_only: MUSIC_STATTRAK_ONLY.has(m.name)
  });
  const nameTr = t(TR, m.loc_name);
  if (nameTr) trNames.musickits[objectId] = nameTr;
}
musicOut.sort((a, b) => a.id - b.id);

// --- Collectibles -------------------------------------------------------------
const collectiblesOut = [];
for (const it of Object.values(items)) {
  const nameToken = it.item_name_resolved;
  if (!nameToken) continue;
  if (COLLECTIBLE_SKIP_IDS.has(it.object_id)) continue;
  const isColl = nameToken.startsWith('#CSGO_Collectible') || nameToken.startsWith('#CSGO_TournamentJournal')
    || nameToken.startsWith('#CSGO_TournamentPass') || nameToken.startsWith('#CSGO_Ticket_');
  if (!isColl) continue;

  // tip (ByMykel getType portu)
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

  // rarity (item_rarity yoksa prefab'dan — ByMykel getCollectibleRarity portu)
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

  collectiblesOut.push({
    id: Number(it.object_id), name, rarity,
    imageUrl: it.image_inventory ? img(String(it.image_inventory).toLowerCase()) : null,
    type: type || 'Collectible',
    genuine
  });
  const nameTr = t(TR, nameToken);
  if (nameTr) trNames.collectibles[it.object_id] = genuine ? `${t(TR, 'genuine') || 'Genuine'} ${nameTr}` : nameTr;
}
collectiblesOut.sort((a, b) => a.id - b.id);

// --- Agents -------------------------------------------------------------------
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
    imageUrl: img(`econ/characters/${it.name.toLowerCase()}`)
  });
  const nameTr = t(TR, it.item_name_resolved);
  if (nameTr) trNames.agents[it.object_id] = nameTr;
}
for (const teamObj of Object.values(agentsOut)) {
  for (const g of Object.values(teamObj)) g.skins.sort((x, y) => x.skinId - y.skinId);
}

// --- catalog-game/ yaz --------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
const gameCounts = {};
const writeOut = (name, data) => {
  writeJson(path.join(OUT, name), data);
  gameCounts[name] = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`  catalog-game/${name}: ${gameCounts[name]} kayıt`);
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
writeJson(path.join(OUT, 'index.json'), {
  generated_at: new Date().toISOString(),
  game_version: version,
  files: gameCounts,
  warnings: {
    unmatchedIcons: report.unmatchedIcons.length,
    missingRarity: report.missingRarity.length,
    missingName: report.missingName.length
  }
});
if (report.unmatchedIcons.length || report.missingRarity.length || report.missingName.length) {
  console.log(`  UYARI: eşlenemeyen ikon=${report.unmatchedIcons.length}, rarity'siz=${report.missingRarity.length}, isimsiz=${report.missingName.length} (detay: catalog-game/build-warnings.json)`);
  writeJson(path.join(OUT, 'build-warnings.json'), report);
}

// [5] Tutarlılık: catalog/ (ByMykel) vs catalog-game/ (bizim üretim)
console.log('[5/7] Tutarlılık karşılaştırması (catalog vs catalog-game)...');
const consistency = {};
function idsOfFlat(dir, f) {
  const d = readJsonIf(path.join(dir, f));
  return new Set((d || []).map(x => String(x.id)));
}
for (const f of ['stickers.json', 'keychains.json', 'musickits.json', 'collectibles.json']) {
  const a = idsOfFlat(CATALOG, f), b = idsOfFlat(OUT, f);
  const onlyCatalog = [...a].filter(x => !b.has(x));
  const onlyGame = [...b].filter(x => !a.has(x));
  consistency[f] = { catalog: a.size, game: b.size, onlyCatalog: onlyCatalog.slice(0, 20), onlyGame: onlyGame.slice(0, 20), onlyCatalogCount: onlyCatalog.length, onlyGameCount: onlyGame.length };
  console.log(`  ${f}: catalog=${a.size} game=${b.size} | yalnız catalog=${onlyCatalog.length} yalnız game=${onlyGame.length}`);
}
function skinKeys(dir) {
  const set = new Set();
  for (const f of ['weapons.json', 'knives.json', 'gloves.json']) {
    const d = readJsonIf(path.join(dir, f)) || {};
    for (const [k, v] of Object.entries(d)) for (const s of v.skins || []) set.add(`${k}#${s.skinId}`);
  }
  return set;
}
{
  const a = skinKeys(CATALOG), b = skinKeys(OUT);
  const onlyCatalog = [...a].filter(x => !b.has(x));
  const onlyGame = [...b].filter(x => !a.has(x));
  consistency['skins'] = { catalog: a.size, game: b.size, onlyCatalog: onlyCatalog.slice(0, 30), onlyGame: onlyGame.slice(0, 30), onlyCatalogCount: onlyCatalog.length, onlyGameCount: onlyGame.length };
  console.log(`  skins (weapon#paint): catalog=${a.size} game=${b.size} | yalnız catalog=${onlyCatalog.length} yalnız game=${onlyGame.length}`);
}
writeJson(path.join(OUT, 'consistency-report.json'), consistency);

// [6] Yeni eklenen itemler (önceki catalog/ ile diff)
console.log('[6/7] Yeni itemler:');
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

// [7] git commit + push
if (NO_GIT) {
  console.log('[7/7] --no-git verildi, commit/push atlandı.');
} else {
  console.log('[7/7] git commit + push...');
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
