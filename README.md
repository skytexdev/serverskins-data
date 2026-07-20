# serverskins-data

ServerSkins için **merkezi CS2 item kataloğu** — silahlar, bıçaklar, eldivenler,
ajanlar, çıkartmalar (sticker), keychain'ler, müzik kitleri ve koleksiyon
öğeleri (pin/coin/madalya). Katalog, ServerSkins backend + plugin şemasıyla
**birebir uyumludur** ve tek komutla CS2 güncellemelerine göre yenilenir.

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
| `catalog/`      | **BİRİNCİL** çıktı — ByMykel/CSGO-API snapshot'ından bizim şemamıza dönüştürülmüş birleşik JSON'lar |
| `catalog-game/` | **İKİNCİL/doğrulama** çıktısı — Valve `items_game.txt` + `csgo_english.txt`'den bağımsız üretim (aynı şema) + Türkçe isimler + tutarlılık raporu |
| `raw/`          | Kaynak snapshot'lar: `raw/en/` (ByMykel), `raw/game/` (Valve oyun dosyaları) + `raw/meta.json` (commit/sürüm meta) |
| `scripts/`      | `build.mjs`, `update-from-game.mjs`, `apply-to-backend.mjs`, `keyvalues.mjs` |
| `schema.md`     | Alan-alan şema dokümanı (backend uyumu) |

## Katalog içeriği (güncel sürüm)

CS2 `1.41.7.1` (Jul 16 2026) — ByMykel commit `cc0ae53`:

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

`catalog-game/` bağımsız üretimi bu sayıların **tamamıyla birebir** eşleşir
(bkz. `catalog-game/consistency-report.json` — tüm kategorilerde 0 fark).

## Şema

Tam alan yapısı için **[schema.md](schema.md)**. Özet:
- Rarity tek tip küçük harf string: `default`, `common`, `uncommon`, `consumer`,
  `milspec`, `restricted`, `classified`, `covert`, `contraband`, `gold`.
- `weapons/knives/gloves` → `{ itemKey: { ...meta, skins: [...] } }`
  (itemKey = oyunun entity adı, backend anahtarlarıyla aynı; ör. `weapon_ak47`).
- `agents` → `{ "2"|"3": { groupKey: { agentName, skins } } }`.
- `stickers/keychains/musickits/collectibles` → düz dizi `[ { id, name, rarity, imageUrl, ... } ]`.
- Görsel URL'leri ByMykel counter-strike-image-tracker CDN'inden (Steam economy /
  akamai image tracker).

## CS2 güncellemesi gelince

**Tek komut** — kaynakları indirir, kataloğu yeniden üretir, tutarlılığı kontrol
eder, yeni item'leri listeler ve değişiklik varsa commit + push eder:

```
node scripts/update-from-game.mjs
```

- Oyun sürümü değişmemişse **hiçbir şey indirmeden** "GÜNCEL" der ve çıkar.
- `--force` : sürüm aynı olsa da yeniden üretir.
- `--no-git` : commit/push adımını atlar (yalnızca dosyaları üretir).
- `GIT_EXE=<yol>` : `git` PATH'te değilse çalıştırılacak git ikilisi.
  (git yoksa 7. adımda **görünür hata** verir — sessiz fallback yoktur.)

### Güncelleyici ne yapar (akış)

1. `SteamDatabase/GameTracking-CS2` → `steam.inf` ile sürüm kontrolü.
2. Ham kaynakları indirir:
   `items_game.txt`, `csgo_english.txt` (GameTracking-CS2),
   `csgo_turkish.json` (counter-strike-file-tracker),
   `images.json` + `default_generated.json` (counter-strike-image-tracker) →
   `raw/game/`; ByMykel snapshot → `raw/en/`.
3. `build.mjs` → `catalog/` (ByMykel'den, birincil).
4. `items_game.txt` + `csgo_english.txt` KeyValues parse → `catalog-game/`
   (Valve'dan bağımsız ikincil üretim) + `names.tr.json` (Türkçe isimler).
5. `catalog/` ⇄ `catalog-game/` id-düzeyi tutarlılık raporu.
6. Önceki `catalog/` id'leriyle diff → **yeni eklenen item'ler** konsola.
7. Değişiklik varsa `git commit + push` (`Auto-update: CS2 <sürüm>`).

## Veri kaynağı / metodoloji (ByMykel yöntemi)

ByMykel/CSGO-API, verisini şu üç Valve kaynağını harmanlayarak üretir; bu repo
aynı yöntemi hem ByMykel snapshot'ından (`catalog/`) hem de doğrudan Valve
dosyalarından (`catalog-game/`) çalıştırıp iki üretimi karşılaştırır:

1. **`items_game.txt`** — item/paint_kit/sticker_kit/keychain/music/collectible/
   agent tanımları, rarity loot list'leri, koleksiyon (`item_sets`) eşlemeleri.
   Kaynak: `SteamDatabase/GameTracking-CS2` (Valve her CS2 yamasında otomatik
   commit'ler — sürüm takibi buradan yapılır).
2. **`csgo_english.txt`** (+ `csgo_turkish.json`) — `#Token` → görünen ad
   çevirileri (`lang.Tokens`).
3. **counter-strike-image-tracker** — `images.json` ile ikon path → CDN görsel
   URL eşlemesi; listede olmayanlar için `panorama/images/<path>_png.png`.

Rarity, koleksiyon, StatTrak/Souvenir, Doppler fazı ve ByMykel'in belgelenmiş
istisnaları (`services/*.js` port'u) `update-from-game.mjs` içinde birebir
kodlanmıştır. Eşlenemeyen kayıtlar **sessizce düşmez**; `catalog-game/build-warnings.json`
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

Son dry-run: yalnızca `agents.json` değişirdi (51 rarity düzeltmesi); diğer tüm
dosyalar zaten güncel.

## İlkeler

- **Sessiz fallback yok.** Veri yoksa/eşlenemezse görünür hata veya rapor.
- **Bağımlılık yok.** Tüm script'ler saf Node (`fetch` + yerel `keyvalues.mjs`).
- **İki bağımsız üretim.** `catalog/` (ByMykel) ile `catalog-game/` (Valve) her
  güncellemede karşılaştırılır; fark = veri hatası sinyali.
