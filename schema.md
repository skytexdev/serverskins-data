# serverskins-data — Katalog Şeması

`catalog/` altındaki dosyalar ServerSkins backend + plugin'inin kullandığı birleşik
CS2 item kataloğudur. Alan yapısı `serverskins/backend/data` ile birebir uyumludur
(fazladan zengin alanlar içerir; backend bunları yok sayabilir).

Tüm dosyalar UTF-8 JSON'dur. Raw erişim:

```
https://raw.githubusercontent.com/skytexdev/serverskins-data/main/catalog/<dosya>
```

## Rarity değerleri

Tek tip küçük harf string: `default`, `common`, `uncommon`, `consumer`, `milspec`,
`restricted`, `classified`, `covert`, `contraband`, `gold`.

Oyun (items_game.txt) rarity id eşlemesi (`update-from-game.mjs` `RARITY_*`
tabloları, backend verisiyle çapraz doğrulanmıştır):

| Oyun (silah)              | Bizim      | Oyun (kozmetik/agent)      | Bizim      |
|---------------------------|------------|----------------------------|------------|
| rarity_common_weapon      | common     | rarity_default / _common   | consumer   |
| rarity_uncommon_weapon    | uncommon   | rarity_rare                | milspec    |
| rarity_rare_weapon        | milspec    | rarity_mythical            | restricted |
| rarity_mythical_weapon    | restricted | rarity_legendary           | classified |
| rarity_legendary_weapon   | classified | rarity_ancient             | covert     |
| rarity_ancient_weapon     | covert     | rarity_contraband          | contraband |
| rarity_contraband_weapon  | contraband | (bıçak/eldiven her zaman)  | gold       |

## catalog/weapons.json — `{ itemKey: WeaponEntry }`

`itemKey`: oyunun entity adı, backend anahtarlarıyla aynı (ör. `weapon_ak47`;
alias'lar backend'e göre: `weapon_sg553`, `weapon_knife_bayonet`, `moto_gloves` ...).

```jsonc
"weapon_ak47": {
  "weaponIndex": 7,          // item defindex
  "team": 2,                 // 0 = iki takım, 2 = T, 3 = CT
  "weaponName": "AK-47",     // görünen ad (EN)
  "class": "rifles",         // backend dosya yönlendirmesi:
                             // pistols|rifles|smgs|heavy|common_pistols|common_rifles|common_smgs|common_heavy
  "skins": [ Skin, ... ]     // skinId'ye göre sıralı; ilk kayıt Default (skinId "0")
}
```

`Skin`:

```jsonc
{
  "name": "Redline",                    // faz varsa: "Doppler (Phase 2)"
  "photo": "weapon_ak47_cu_ak47_rubber.png",  // legacy eşleme alanı (itemKey + pattern)
  "legacy_model": true,                 // CS:GO legacy model bayrağı
  "skinId": "630",                      // PAINT INDEX (string) — plugin'in kullandığı ID
  "rarity": "classified",
  "imageUrl": "https://community.akamai.steamstatic.com/economy/image/...",
  "pattern": "cu_ak47_rubber",          // paint kit adı (null = Default)
  "min_float": 0.0, "max_float": 0.8,
  "stattrak": true, "souvenir": false,
  "phase": null,                        // "Phase 1..4" | "Ruby" | "Sapphire" | "Black Pearl" | "Emerald"
  "collections": ["The Huntsman Collection"]   // en fazla 3
}
```

## catalog/knives.json / catalog/gloves.json

`weapons.json` ile aynı yapı; farklar:
- `knifeName` / `gloveName` alanı (`weaponName` yerine), `team` ve `class` yok.
- Skin rarity'si her zaman `gold` (Default girdisi `default`).
- Eldivenlerde Default girdisi yoktur.

## catalog/agents.json — `{ "2"|"3": { groupKey: AgentGroup } }`

Üst anahtar takım (2 = T, 3 = CT). `groupKey` backend'le aynı (ör. `the_professionals`).

```jsonc
"2": {
  "the_professionals": {
    "agentName": "The Professionals",
    "skins": [{
      "name": "Bloody Darryl The Strapped",   // "| Grup" soneki atılmış
      "photo": "4613.png",                    // defindex.png
      "model": "tm_professional/tm_professional_varf5",
      "skinId": 4613,                         // item defindex (number)
      "rarity": "classified",                 // DOĞRU eşlenmiş rarity
      "imageUrl": "..."
    }]
  }
}
```

## catalog/stickers.json — `[Sticker]`

```jsonc
{ "id": 48,                       // sticker kit id (number)
  "name": "3DMAX | Katowice 2014",// "Sticker | " öneki atılmış
  "rarity": "milspec",
  "imageUrl": "..." }
```

## catalog/keychains.json — `[Keychain]`

```jsonc
{ "id": 1, "name": "Lil' Ava",    // "Charm | " öneki atılmış
  "rarity": "milspec", "imageUrl": "..." }
```
Not: Turnuva highlight charm'ları ve Sticker Slab bu listeye girmez.

## catalog/musickits.json — `[MusicKit]`

```jsonc
{ "id": 3,                        // music definition id (number)
  "name": "Daniel Sadowski, Crimson Assault",  // "Music Kit | " önekleri atılmış
  "rarity": "milspec",            // tüm kitler High Grade
  "imageUrl": "...",
  "stattrak": true,               // StatTrak varyantı var mı
  "stattrak_only": false }        // yalnız StatTrak olarak satıldı (7 kit: Beartooth vb.)
```
StatTrak varyantları tek kayda bayrak olarak birleştirilir. 101 kayıt = oyunun
`music_definitions` tablosunun tamamı.

## catalog/collectibles.json — `[Collectible]`  (backend'de `pins.json`)

```jsonc
{ "id": 874,                      // item defindex (number)
  "name": "5 Year Veteran Coin",
  "rarity": "covert",
  "imageUrl": "...",
  "type": "Collectible",          // Pin | Service Medal | Operation Coin | ... (null → "Collectible")
  "genuine": false }              // attendance_pin ("Genuine" öneki isimde)
```

## catalog/index.json

Üretim metası: `generated_at`, `source` (raw/meta.json içeriği), dosya başına kayıt sayısı.

## catalog/ ek dosyaları

`scripts/update-from-game.mjs` üretimi sırasında `catalog/` altına ek olarak:
- `names.tr.json` — Türkçe isimler: `{ skins: {"itemKey#skinId": ad}, stickers: {id: ad}, ... }`
- `build-warnings.json` — eşlenemeyen `[paint]item` anahtarları / rarity'si veya
  ismi olmayan kombinasyonlar (oyunda yayınlanmamış kayıtlar; bilinçli olarak
  hariç, sessiz düşme yok)

## raw/

- `raw/game/` — Valve oyun dosyaları (SteamDatabase/GameTracking-CS2):
  `items_game.txt`, `csgo_english.txt`, `csgo_turkish.txt`,
  `steam.inf` + `version.json` (sürüm takibi)
- `raw/meta.json` — kaynak/sürüm meta (Valve oyun sürümü)
