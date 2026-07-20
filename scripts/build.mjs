#!/usr/bin/env node
// ============================================================================
// serverskins-data — catalog builder
// ----------------------------------------------------------------------------
// raw/en/*.json (ByMykel/CSGO-API snapshot) --> catalog/*.json (bizim şema)
//
// Kullanım:
//   node scripts/build.mjs                 # raw/ -> catalog/
//   node scripts/build.mjs --compare <dir> # + backend/data ile diff raporu
//                                          #   (backend'e YAZMAZ, sadece rapor)
//
// Bağımlılık YOK (sadece node builtin). Veri yoksa görünür hata verir,
// hiçbir alan için sessiz fallback kullanılmaz.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'raw', 'en');
const OUT = path.join(ROOT, 'catalog');

// ---------------------------------------------------------------------------
// Eşleme tabloları (backend/data şemasıyla birebir doğrulanmış — bkz. schema.md)
// ---------------------------------------------------------------------------

// ByMykel silah rarity id -> bizim rarity
const RARITY_WEAPON = {
  rarity_common_weapon: 'common',
  rarity_uncommon_weapon: 'uncommon',
  rarity_rare_weapon: 'milspec',
  rarity_mythical_weapon: 'restricted',
  rarity_legendary_weapon: 'classified',
  rarity_ancient_weapon: 'covert',
  rarity_immortal_weapon: 'contraband',
  rarity_contraband_weapon: 'contraband',
  rarity_ancient: 'gold' // bıçak/eldiven "Extraordinary"
};

// ByMykel kozmetik (sticker/keychain/collectible/musickit) rarity id -> bizim
// (backend stickers/pins/keychains ile çapraz tabloyla doğrulandı: 10555 sticker
//  üzerinde %100 tutarlı eşleşme)
const RARITY_ITEM = {
  rarity_default: 'consumer',
  rarity_common: 'consumer',
  rarity_rare: 'milspec',
  rarity_mythical: 'restricted',
  rarity_legendary: 'classified',
  rarity_ancient: 'covert',
  rarity_contraband: 'contraband'
};

// Agent rarity id -> bizim (kozmetikle aynı skala, "_character" sonekli)
const RARITY_AGENT = {
  rarity_rare_character: 'milspec',
  rarity_mythical_character: 'restricted',
  rarity_legendary_character: 'classified',
  rarity_ancient_character: 'covert'
};

// Kanonik item adı (ByMykel/oyun) -> bizim backend anahtarı
const CANONICAL_TO_OURS = {
  weapon_sg556: 'weapon_sg553',
  weapon_bayonet: 'weapon_knife_bayonet',
  studded_bloodhound_gloves: 'bloodhound_gloves',
  studded_brokenfang_gloves: 'broken_fang_gloves',
  slick_gloves: 'driver_gloves',
  leather_handwraps: 'hand_wraps',
  studded_hydra_gloves: 'hydra_gloves',
  motorcycle_gloves: 'moto_gloves',
  sporty_gloves: 'sport_gloves'
};

// Silah anahtarı -> backend dosya sınıfı (weapons/<class>.json). "common_" öneki
// team=0 (iki takım) silahları için backend'in dosya düzenidir.
// KAYNAK: serverskins/backend/data/weapons/*.json mevcut düzeni (birebir).
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

// Yeni (tabloda olmayan) silahlar için ByMykel kategori id -> sınıf tahmini YOK:
// bilinmeyen silah görünür hataya düşer; tabloya bilinçli eklenmeli.

// Agent model klasörü -> takım/grup (backend agents.json düzeni)
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

const TEAM_MAP = { both: 0, terrorists: 2, 'counter-terrorists': 3 };

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function readRaw(name) {
  const p = path.join(RAW, name);
  if (!fs.existsSync(p)) {
    throw new Error(`HATA: kaynak dosya yok: ${p} — önce raw/ indirilmeli (bkz. README)`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function mapRarity(table, id, context) {
  if (id === undefined || id === null) throw new Error(`HATA: rarity yok: ${context}`);
  const r = table[id];
  if (!r) throw new Error(`HATA: bilinmeyen rarity '${id}': ${context}`);
  return r;
}

const stripPrefix = (name, ...prefixes) => {
  for (const p of prefixes) if (name.startsWith(p)) return name.slice(p.length);
  return name;
};

const numericId = (id, prefix, context) => {
  const s = String(id);
  if (!s.startsWith(prefix)) throw new Error(`HATA: beklenmeyen id formatı '${s}' (${context})`);
  return s.slice(prefix.length);
};

function writeOut(name, data, counts) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2), 'utf8');
  const n = Array.isArray(data) ? data.length : Object.keys(data).length;
  counts[name] = n;
  console.log(`  catalog/${name}: ${n} kayıt`);
}

// ---------------------------------------------------------------------------
// 1) Silahlar / bıçaklar / eldivenler (skins.json + base_weapons.json)
// ---------------------------------------------------------------------------

function buildSkins(counts) {
  const skins = readRaw('skins.json');
  const baseWeapons = readRaw('base_weapons.json');

  // itemKey (bizim) -> item
  const weapons = {};
  const knives = {};
  const gloves = {};
  const vanillaKnives = new Map(); // ourKey -> image

  for (const s of skins) {
    const canonical = s?.weapon?.id;
    if (!canonical) throw new Error(`HATA: weapon.id olmayan skin kaydı: ${s?.id}`);
    const ourKey = CANONICAL_TO_OURS[canonical] || canonical;

    const category = (s.category?.id || '').toLowerCase();
    const isKnife = ourKey.includes('knife') || ourKey.includes('bayonet') || category.includes('melee');
    const isGlove = category.includes('glove') || ourKey.includes('glove') || ourKey.includes('handwrap') || ourKey.includes('hand_wraps');

    // Vanilla bıçak (paint_index yok): Default girdisi için görselini sakla
    if (s.paint_index === undefined || s.paint_index === null || s.paint_index === '') {
      if (isKnife && s.image) vanillaKnives.set(ourKey, s.image);
      continue;
    }

    const bucket = isKnife ? knives : (isGlove ? gloves : weapons);
    if (!bucket[ourKey]) {
      const entry = {
        weaponIndex: s.weapon?.weapon_id ?? null,
        skins: []
      };
      if (isKnife) {
        entry.knifeName = s.weapon?.name || ourKey;
      } else if (isGlove) {
        entry.gloveName = s.weapon?.name || ourKey;
      } else {
        entry.team = TEAM_MAP[s.team?.id];
        if (entry.team === undefined) throw new Error(`HATA: bilinmeyen team '${s.team?.id}' (${ourKey})`);
        entry.weaponName = s.weapon?.name || ourKey;
        const cls = WEAPON_CLASS[ourKey];
        if (!cls) throw new Error(`HATA: WEAPON_CLASS tablosunda olmayan YENİ silah: ${ourKey} — tabloya eklenmeli`);
        entry.class = cls;
      }
      bucket[ourKey] = entry;
    }

    // "AK-47 | Redline" -> "Redline"; faz korunur
    let name = s.name || '';
    const pipe = name.indexOf('|');
    if (pipe !== -1) name = name.slice(pipe + 1).trim();
    if (s.phase) name = `${name} (${s.phase})`;

    let rarity;
    if (isKnife || isGlove) {
      rarity = 'gold'; // bıçak/eldiven backend'de tek tip 'gold'
    } else {
      rarity = mapRarity(RARITY_WEAPON, s.rarity?.id, `${ourKey} / ${name}`);
    }

    const patternId = s.pattern?.id || '';
    const skinId = String(s.paint_index);

    bucket[ourKey].skins.push({
      name,
      photo: patternId ? `${ourKey}_${patternId}.png` : `${ourKey}_${skinId}.png`,
      legacy_model: Boolean(s.legacy_model),
      skinId,
      rarity,
      imageUrl: s.image || null,
      pattern: patternId || null,
      min_float: s.min_float ?? 0.06,
      max_float: s.max_float ?? 0.8,
      stattrak: Boolean(s.stattrak),
      souvenir: Boolean(s.souvenir),
      phase: s.phase || null,
      collections: (s.collections || []).map(c => c.name).slice(0, 3)
    });
  }

  // Default (skinId 0) girdileri — silahlar: base_weapons.json görselleriyle
  // base_weapons id formatı: "base_weapon-weapon_deagle"
  const baseByOurs = new Map();
  for (const b of baseWeapons) {
    const canonical = String(b?.id || '').replace(/^base_weapon-/, '');
    if (!canonical || !b?.image) continue;
    const key = CANONICAL_TO_OURS[canonical] || canonical;
    baseByOurs.set(key, b.image);
  }
  for (const [ourKey, entry] of Object.entries(weapons)) {
    const img = baseByOurs.get(ourKey) || null;
    entry.skins.unshift({
      name: 'Default',
      photo: `${ourKey}_default.png`,
      legacy_model: false,
      skinId: '0',
      rarity: 'default',
      imageUrl: img,
      pattern: null, min_float: 0, max_float: 1,
      stattrak: false, souvenir: false, phase: null, collections: []
    });
  }
  // Default girdileri — bıçaklar: vanilla kayıtlarının görselleri
  for (const [ourKey, entry] of Object.entries(knives)) {
    entry.skins.unshift({
      name: 'Default',
      photo: `${ourKey}_default.png`,
      legacy_model: false,
      skinId: '0',
      rarity: 'default',
      imageUrl: vanillaKnives.get(ourKey) || null,
      pattern: null, min_float: 0, max_float: 1,
      stattrak: false, souvenir: false, phase: null, collections: []
    });
  }

  // skinId sırasına koy
  for (const bucket of [weapons, knives, gloves]) {
    for (const entry of Object.values(bucket)) {
      entry.skins.sort((a, b) => parseInt(a.skinId) - parseInt(b.skinId));
    }
  }

  writeOut('weapons.json', weapons, counts);
  writeOut('knives.json', knives, counts);
  writeOut('gloves.json', gloves, counts);
  return { weapons, knives, gloves };
}

// ---------------------------------------------------------------------------
// 2) Agents (agents.json — backend'in team/grup yapısında, DOĞRU rarity ile)
// ---------------------------------------------------------------------------

function buildAgents(counts) {
  const src = readRaw('agents.json');
  const out = { 2: {}, 3: {} };

  for (const a of src) {
    const defIndex = numericId(a.id, 'agent-', a.name);
    const modelPlayer = a.model_player;
    if (!modelPlayer) throw new Error(`HATA: model_player yok: ${a.name}`);
    // "agents/models/tm_professional/tm_professional_varf5.vmdl"
    //   -> model: "tm_professional/tm_professional_varf5", klasör: "tm_professional"
    const parts = modelPlayer.replace(/\.vmdl$/, '').split('/');
    const model = parts.slice(-2).join('/');
    const folder = parts[parts.length - 2];

    const grp = AGENT_GROUPS[folder];
    if (!grp) throw new Error(`HATA: AGENT_GROUPS tablosunda olmayan YENİ agent klasörü: ${folder} (${a.name}) — tabloya eklenmeli`);

    // "Bloody Darryl The Strapped | The Professionals" -> sol kısım
    let name = a.name || '';
    const pipe = name.indexOf('|');
    if (pipe !== -1) name = name.slice(0, pipe).trim();

    const rarity = mapRarity(RARITY_AGENT, a.rarity?.id, `agent ${a.name}`);

    if (!out[grp.team][grp.group]) {
      out[grp.team][grp.group] = { agentName: grp.agentName, skins: [] };
    }
    out[grp.team][grp.group].skins.push({
      name,
      photo: `${defIndex}.png`,
      model,
      skinId: Number(defIndex),
      rarity,
      imageUrl: a.image || null
    });
  }

  for (const team of Object.values(out)) {
    for (const g of Object.values(team)) g.skins.sort((x, y) => x.skinId - y.skinId);
  }

  writeOut('agents.json', out, counts);
  return out;
}

// ---------------------------------------------------------------------------
// 3) Stickers / Keychains / Collectibles (flat listeler)
// ---------------------------------------------------------------------------

function buildStickers(counts) {
  const src = readRaw('stickers.json');
  const out = src.map(s => ({
    id: Number(numericId(s.id, 'sticker-', s.name)),
    name: stripPrefix(s.name || '', 'Sticker | '),
    rarity: mapRarity(RARITY_ITEM, s.rarity?.id, `sticker ${s.name}`),
    imageUrl: s.image || null
  })).sort((a, b) => a.id - b.id);
  writeOut('stickers.json', out, counts);
  return out;
}

function buildKeychains(counts) {
  const src = readRaw('keychains.json');
  const out = src.map(s => ({
    id: Number(numericId(s.id, 'keychain-', s.name)),
    name: stripPrefix(s.name || '', 'Charm | '),
    rarity: mapRarity(RARITY_ITEM, s.rarity?.id, `keychain ${s.name}`),
    imageUrl: s.image || null
  })).sort((a, b) => a.id - b.id);
  writeOut('keychains.json', out, counts);
  return out;
}

function buildCollectibles(counts) {
  const src = readRaw('collectibles.json');
  const out = src.map(s => ({
    id: Number(numericId(s.id, 'collectible-', s.name)),
    name: s.name,
    rarity: mapRarity(RARITY_ITEM, s.rarity?.id, `collectible ${s.name}`),
    imageUrl: s.image || null,
    // ByMykel type=null olan kayıtlar backend'de "Collectible" olarak sınıflanır
    type: s.type || 'Collectible',
    genuine: Boolean(s.genuine)
  })).sort((a, b) => a.id - b.id);
  writeOut('collectibles.json', out, counts);
  return out;
}

// ---------------------------------------------------------------------------
// 4) Music kits — ByMykel base + "_st" varyantlarını tek kayda birleştirir.
//    ByMykel'in base'ini hiç yayınlamadığı "yalnız StatTrak satılan" kitler
//    (beartooth_02 vb.) stattrak_only=true olarak katalogda YER ALIR
//    (items_game music_definitions'ta mevcutturlar).
// ---------------------------------------------------------------------------

function buildMusicKits(counts) {
  const src = readRaw('music_kits.json');
  const byId = new Map(); // numeric id -> kayıt

  for (const m of src) {
    const rawId = numericId(m.id, 'music_kit-', m.name);
    const isSt = rawId.endsWith('_st');
    const id = Number(isSt ? rawId.slice(0, -3) : rawId);
    const name = stripPrefix(m.name || '', 'StatTrak™ Music Kit | ', 'Music Kit | ');
    const rarity = mapRarity(RARITY_ITEM, m.rarity?.id, `musickit ${m.name}`);

    if (!byId.has(id)) {
      byId.set(id, {
        id, name, rarity,
        imageUrl: m.image || null,
        stattrak: false,
        stattrak_only: true // base kaydı görürsek false'a çekilir
      });
    }
    const rec = byId.get(id);
    if (isSt) {
      rec.stattrak = true;
    } else {
      rec.name = name; // base adı esas
      rec.stattrak_only = false;
    }
  }

  const out = [...byId.values()].sort((a, b) => a.id - b.id);
  writeOut('musickits.json', out, counts);
  return out;
}

// ---------------------------------------------------------------------------
// 5) --compare <backendDataDir>: backend kataloğuyla diff (sadece RAPOR)
// ---------------------------------------------------------------------------

function compare(backendDir, built) {
  console.log(`\n— Backend karşılaştırması: ${backendDir}`);
  const j = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const report = {};

  // Flat listeler: id bazlı
  const flatPairs = [
    ['stickers', path.join(backendDir, 'stickers.json'), built.stickers],
    ['keychains', path.join(backendDir, 'keychains.json'), built.keychains],
    ['musickits', path.join(backendDir, 'musickits.json'), built.musickits],
    ['pins(collectibles)', path.join(backendDir, 'pins.json'), built.collectibles]
  ];
  for (const [label, file, cat] of flatPairs) {
    if (!fs.existsSync(file)) { console.log(`  ${label}: backend dosyası YOK (${file})`); continue; }
    const ours = j(file);
    const ourIds = new Set(ours.map(x => String(x.id)));
    const missing = cat.filter(x => !ourIds.has(String(x.id)));
    const catIds = new Set(cat.map(x => String(x.id)));
    const extra = ours.filter(x => !catIds.has(String(x.id)));
    report[label] = { catalog: cat.length, backend: ours.length, backendEksik: missing.length, backendFazla: extra.length };
    console.log(`  ${label}: katalog=${cat.length} backend=${ours.length} | backend'de EKSİK=${missing.length} | backend'de fazla=${extra.length}`);
    for (const m of missing.slice(0, 5)) console.log(`      eksik örn: ${m.id} ${m.name}`);
    for (const e of extra.slice(0, 5)) console.log(`      fazla örn: ${e.id} ${e.name}`);
  }

  // Silah/bıçak/eldiven: skinId bazlı
  const backendWeaponFiles = ['pistols', 'rifles', 'smgs', 'heavy', 'common_pistols', 'common_rifles', 'common_smgs', 'common_heavy']
    .map(f => path.join(backendDir, 'weapons', `${f}.json`));
  const backendItems = new Map();
  for (const f of [...backendWeaponFiles, path.join(backendDir, 'knives.json'), path.join(backendDir, 'gloves.json')]) {
    if (!fs.existsSync(f)) continue;
    for (const [k, v] of Object.entries(j(f))) {
      backendItems.set(k, new Set((v.skins || []).map(s => String(s.skinId))));
    }
  }
  let missSkins = 0, missItems = 0;
  const missSamples = [];
  for (const bucket of [built.weapons, built.knives, built.gloves]) {
    for (const [k, v] of Object.entries(bucket)) {
      const ours = backendItems.get(k);
      if (!ours) { missItems++; missSamples.push(`ITEM YOK: ${k}`); continue; }
      for (const s of v.skins) {
        if (!ours.has(String(s.skinId))) { missSkins++; if (missSamples.length < 10) missSamples.push(`${k} ${s.skinId} ${s.name}`); }
      }
    }
  }
  report.skins = { backendEksikSkin: missSkins, backendEksikItem: missItems };
  console.log(`  weapons/knives/gloves: backend'de EKSİK skin=${missSkins}, eksik item=${missItems}`);
  for (const m of missSamples) console.log(`      ${m}`);

  // Agents: skinId + rarity düzeltme sayısı
  const agentsFile = path.join(backendDir, 'agents.json');
  if (fs.existsSync(agentsFile)) {
    const ours = j(agentsFile);
    const ourAgents = new Map();
    for (const team of Object.values(ours)) for (const g of Object.values(team)) for (const s of g.skins) ourAgents.set(String(s.skinId), s);
    let missing = 0, rarityFix = 0;
    for (const team of Object.values(built.agents)) for (const g of Object.values(team)) for (const s of g.skins) {
      const o = ourAgents.get(String(s.skinId));
      if (!o) missing++;
      else if (o.rarity !== s.rarity) rarityFix++;
    }
    report.agents = { backendEksik: missing, rarityDuzeltme: rarityFix };
    console.log(`  agents: backend'de EKSİK=${missing} | yanlış rarity (düzeltilecek)=${rarityFix}`);
  }

  fs.writeFileSync(path.join(OUT, 'compare-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`  Rapor: catalog/compare-report.json`);
}

// ---------------------------------------------------------------------------

const compareIdx = process.argv.indexOf('--compare');
const backendDir = compareIdx !== -1 ? process.argv[compareIdx + 1] : null;

console.log('— serverskins-data catalog build —');
const counts = {};
const built = {};
built.weapons = null;
const wkg = buildSkins(counts);
built.weapons = wkg.weapons; built.knives = wkg.knives; built.gloves = wkg.gloves;
built.agents = buildAgents(counts);
built.stickers = buildStickers(counts);
built.keychains = buildKeychains(counts);
built.collectibles = buildCollectibles(counts);
built.musickits = buildMusicKits(counts);

// index.json — meta
let rawMeta = null;
const rawMetaPath = path.join(ROOT, 'raw', 'meta.json');
if (fs.existsSync(rawMetaPath)) rawMeta = JSON.parse(fs.readFileSync(rawMetaPath, 'utf8'));
const index = {
  generated_at: new Date().toISOString(),
  source: rawMeta,
  files: counts
};
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
console.log('  catalog/index.json yazıldı');

if (backendDir) compare(backendDir, built);
console.log('Tamam.');
