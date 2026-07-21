# serverskins-data

ServerSkins için **merkezi CS2 item kataloğu** — silahlar, bıçaklar, eldivenler,
ajanlar, çıkartmalar (sticker), keychain'ler, müzik kitleri ve koleksiyon
öğeleri (pin/coin/madalya). Katalog, ServerSkins backend + plugin şemasıyla
**birebir uyumludur** ve tek komutla, **doğrudan Valve CS2 oyun dosyalarından**
CS2 güncellemelerine göre yenilenir.

Bu repo bir **veri API'sidir**: JSON dosyaları doğrudan `raw.githubusercontent.com`
üzerinden çekilir; ayrı bir sunucu gerekmez.

```
https://raw.githubusercontent.com/skytexdev/serverskins-data/main/catalog/<dosya>
```

Örnekler:

```
.../main/catalog/weapons.json
.../main/catalog/stickers.json
.../main/catalog/collectibles.json
.../main/catalog/index.json      ← üretim metası + kayıt sayıları
```

## Klasör yapısı

| Klasör          | İçerik |
|-----------------|--------|
| `catalog/`      | **Çıktı** — Valve `items_game.txt` + `csgo_english.txt` + `csgo_turkish.txt`'ten bizim şemamıza dönüştürülmüş birleşik JSON'lar + `names.tr.json` (Türkçe isimler) |
| `raw/`          | Kaynak dosyalar: `raw/game/` (Valve oyun dosyaları) + `raw/meta.json` (sürüm/commit meta) |
| `scripts/`      | `update-from-game.mjs` (güncelleyici), `apply-to-backend.mjs` (backend'e uygula), `keyvalues.mjs` (KeyValues parser) |
| `schema.md`     | Alan-alan şema dokümanı (backend uyumu) |

## Katalog içeriği (güncel sürüm)

CS2 `1.41.7.1` (Jul 16 2026):

| Dosya                  | Kayıt | Not |
|------------------------|-------|-----|
| `weapons.json`         | 35 silah | 2161 skin (bıçak+eldiven+default dahil, `weapon#paint`) |
| `knives.json`          | 20 bıçak tipi | rarity her zaman `gold` |
| `gloves.json`          | 8 eldiven tipi | |
| `agents.json`          | 63 ajan | takıma göre (`"2"` T / `"3"` CT) |
| `stickers.json`        | 10555 | "Katowice 2014", "Global Elite" vb. dahil |
| `keychains.json`       | 78 | turnuva highlight/Sticker Slab hariç |
| `musickits.json`       | 101 | StatTrak bayrağı birleştirilmiş |
| `collectibles.json`    | 667 | backend'de `pins.json` (coin/pin/madalya) |

## Şema

Tam alan yapısı için **[schema.md](schema.md)**. Özet:
- Rarity tek tip küçük harf string: `default`, `common`, `uncommon`, `consumer`,
  `milspec`, `restricted`, `classified`, `covert`, `contraband`, `gold`.
- `weapons/knives/gloves` → `{ itemKey: { ...meta, skins: [...] } }`
  (itemKey = oyunun entity adı, backend anahtarlarıyla aynı; ör. `weapon_ak47`).
- `agents` → `{ "2"|"3": { groupKey: { agentName, skins } } }`.
- `stickers/keychains/musickits/collectibles` → düz dizi `[ { id, name, rarity, imageUrl, ... } ]`.
- Görsel URL'leri Steam economy / akamai CDN'inden gelir. Yeni item için henüz
  görsel çözülemediyse `imageUrl: null` yazılır (GÖRÜNÜR eksik — sessiz fallback yok).

## CS2 güncellemesi gelince

**Tek komut** — Valve kaynaklarını indirir, kataloğu yeniden üretir, yeni
item'leri listeler ve değişiklik varsa commit + push eder:

```
node scripts/update-from-game.mjs
```

- Oyun sürümü değişmemişse **hiçbir şey indirmeden** "GÜNCEL" der ve çıkar.
- `--force` : sürüm aynı olsa da yeniden üretir.
- `--no-git` : commit/push adımını atlar (yalnızca dosyaları üretir).
- `GIT_EXE=<yol>` : `git` PATH'te değilse çalıştırılacak git ikilisi.
  (git yoksa son adımda **görünür hata** verir — sessiz fallback yoktur.)

### Güncelleyici ne yapar (akış)

1. `SteamDatabase/GameTracking-CS2` → `steam.inf` ile sürüm kontrolü.
2. Ham Valve kaynaklarını indirir: `items_game.txt`, `csgo_english.txt`,
   `csgo_turkish.txt` (hepsi GameTracking-CS2) → `raw/game/`.
3. `items_game.txt` + `csgo_*.txt` KeyValues parse → `catalog/` (aynı şema) +
   `catalog/names.tr.json` (Türkçe isimler). Silah/bıçak/eldiven mevcut katalog
   üzerine **eklemeli** işlenir (hiçbir kayıt silinmez); sticker/keychain/müzik/
   koleksiyon/ajan `items_game`'den bütün olarak yeniden üretilir. Görseller
   mevcut katalogdaki gerçek URL'lerden korunur; yeni item için `imageUrl=null`.
4. Önceki `catalog/` id'leriyle diff → **yeni eklenen item'ler** konsola.
5. Değişiklik varsa `git commit + push` (`Auto-update: CS2 <sürüm>`).

## Veri kaynağı

Katalog **yalnızca Valve'ın kendi CS2 oyun dosyalarından** üretilir; hiçbir
üçüncü-taraf katalog/görsel aynası kullanılmaz:

1. **`items_game.txt`** — item / paint_kit / sticker_kit / keychain / music /
   collectible / agent tanımları, rarity loot list'leri (`client_loot_lists`),
   koleksiyon (`item_sets`) eşlemeleri, StatTrak/Souvenir set'leri.
   Kaynak: `SteamDatabase/GameTracking-CS2` (Valve her CS2 yamasında otomatik
   commit'ler — sürüm takibi buradan yapılır).
2. **`csgo_english.txt`** — `#Token` → görünen ad (EN) çevirileri (`lang.Tokens`).
3. **`csgo_turkish.txt`** — Türkçe isimler (resmi Steam yerelleştirmesi);
   `catalog/names.tr.json`'a yazılır.

Silah/bıçak/eldiven skin evreni `client_loot_lists` + `item_sets` içindeki
`[paint]item` kombinasyonlarından çıkarılır. Rarity, koleksiyon, StatTrak/Souvenir,
Doppler fazı ve oyunun sabit-kodlu istisnaları `update-from-game.mjs` içinde
kodlanmıştır. Eşlenemeyen kayıtlar **sessizce düşmez**; `catalog/build-warnings.json`
içinde listelenir.

## Backend'e uygulama

Kataloğu ServerSkins backend'ine (`serverskins/backend/data`) yansıtmak için:

```
node scripts/apply-to-backend.mjs            # DRY-RUN (hiçbir dosya değişmez)
node scripts/apply-to-backend.mjs --write    # gerçekten uygular
node scripts/apply-to-backend.mjs --backend <dizin>   # özel backend yolu
```

Kurallar:
- `stickers/keychains/musickits/pins/agents` → katalogdan **yeniden yazılır**
  (agents'taki yanlış rarity'ler böylece düzelir).
- `weapons/*`, `knives`, `gloves` → **MERGE**: eksik skin/`imageUrl` eklenir,
  mevcut kayıt silinmez ve üzerine yazılmaz.

## İlkeler

- **Sessiz fallback yok.** Veri yoksa/eşlenemezse görünür hata veya rapor;
  görsel çözülemezse `imageUrl: null`.
- **Bağımlılık yok.** Tüm script'ler saf Node (`fetch` + yerel `keyvalues.mjs`).
- **Tek kaynak.** Katalog yalnızca Valve CS2 oyun dosyalarından üretilir.
