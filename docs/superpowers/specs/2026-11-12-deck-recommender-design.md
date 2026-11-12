# Stoner: Koleksiyona Göre Hearthstone Deste Önerici — Tasarım

Tarih: 2026-11-12
Durum: Onay bekliyor

## Amaç

Oyuncunun sahip olduğu kartlara bakarak, güncel meta destelerden hangilerini
kurabileceğini söyleyen ve eksik kartları eldeki kartlarla tamamlayan yerel bir
web uygulaması. Oyuncu, önerilen desteleri tek tek denemek zorunda kalmamalı:
liste kısa, sıralı ve gerekçeli gelmelidir.

Hearthstone her yamada kart ekler, değiştirir ve Standard rotasyonu yapar.
Uygulama bu değişiklikleri kod değişikliği olmadan, tek bir "Güncelle" düğmesiyle
içeri almalıdır.

## Kapsam

Kapsam içinde:

1. Kart verisini, koleksiyonu ve meta desteleri tek düğmeyle güncelleme.
2. Kazanma oranına ve kurulabilirliğe göre sıralı öneri listesi.
3. Eksik kartlara ikame önerisi ve ikameli deste için güven seviyesi.
4. Destede elle kart değiştirme ve yeni deste kodu alma.
5. Herhangi bir kaynaktan deste kodu yapıştırarak deste ekleme.

Kapsam dışında:

- Oyunu otomatik oynatma (istemci otomasyonu). Yapılmayacak.
- Bot bota karşı simülatör.
- Yapay zekâ ile kombo keşfi.
- Kişisel maç sonuçlarının takibi.
- Battlegrounds, Arena, Mercenaries, Twist.

## Çalışma ortamı

- Hedef makine: Windows. Gerekenler: Node.js (22 veya üstü) ve HSReplay
  hesabına bağlı, koleksiyon yüklemesi açık Hearthstone Deck Tracker.
- Geliştirme makinesi: macOS, Node 26. Bu makinenin ağında `hsreplay.net`
  engellidir. HSReplay'e dokunan kod burada yalnızca kayıtlı örnek yanıtlarla
  test edilir; canlı doğrulama Windows makinede yapılır.
- Çalışma zamanı bağımlılığı yok: `node:http`, yerleşik `fetch`, `node:test`,
  `node:fs`. Derleme adımı yok.

## Mimari

Tek bir Node süreci. Yalnızca `127.0.0.1` adresini dinler, `public/` altındaki
statik arayüzü ve küçük bir JSON API'sini sunar. Kalıcı veri `data/` altında
JSON dosyalarıdır.

```
tarayıcı (public/)  <-- HTTP -->  server.js
                                     |
            +------------+-----------+-----------+-------------+
            |            |                       |             |
      kart kaynağı  koleksiyon kaynağı    deste kaynakları   öneri motoru
     HearthstoneJSON    HSReplay        HSReplay + yapıştırma  (saf hesap)
            |            |                       |
        cards.json   collection.json         decks.json
```

Kaynaklar ağa çıkar ve dosya yazar. Öneri motoru ağa ve diske dokunmaz; girdi
olarak üç veri kümesini alır, çıktı olarak öneri listesini döndürür.

## Dosya yapısı

| Dosya | Sorumluluk |
|---|---|
| `server.js` | HTTP sunucusu, API yolları, statik dosyalar |
| `src/store.js` | `data/` altındaki JSON dosyalarını okuma ve atomik yazma |
| `src/sources/cards.js` | HearthstoneJSON'dan kartları indirme ve sadeleştirme |
| `src/sources/collection.js` | HSReplay'den koleksiyonu çekme |
| `src/sources/decks-hsreplay.js` | HSReplay'den meta desteleri ve arketipleri çekme |
| `src/sources/decks-pasted.js` | Yapıştırılan deste kodlarını saklama |
| `src/update.js` | Kaynakları sırayla çalıştırma, kaynak bazında durum kaydı |
| `src/deckstring.js` | Deste kodu çözme ve üretme |
| `src/recommend.js` | Eksik kart, toz maliyeti, sıralama |
| `src/substitute.js` | İkame adayları ve güven seviyesi |
| `public/index.html`, `app.js`, `style.css` | Arayüz |
| `start.bat` | Windows'ta sunucuyu başlatıp tarayıcıyı açma |
| `config.local.json` | HSReplay oturum çerezi, bölge, hesap numarası (git'e girmez) |
| `test/` | `node:test` testleri ve örnek veriler |

`data/` ve `config.local.json` `.gitignore` içindedir.

## Veri dosyaları

`data/cards.json`: yalnızca toplanabilir kartlar. Kart başına: `dbfId`, `id`,
`name`, `cardClass`, `classes`, `cost`, `type`, `rarity`, `set`, `race`,
`spellSchool`, `mechanics`, `text`. Ayrıca indirildiği andaki Standard setlerinin
listesi.

`data/collection.json`: `dbfId` → sahip olunan adet (normal, altın ve diğer
sürümlerin toplamı).

`data/decks.json`: deste listesi. Deste başına: `id`, `source` (`hsreplay` ya da
`pasted`), `name`, `archetype`, `cardClass`, `format`, `cards` (`dbfId` → adet),
varsa `winRate` ve `games`.

`data/status.json`: kaynak başına son başarılı güncelleme zamanı ve son hata.

## Kaynaklar

### Kartlar

`https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json`.
Geliştirme makinesinden erişilebildiği doğrulandı. Standard setlerinin listesi
kodda sabit tutulmaz; rotasyonda elle düzenleme gerekmemesi için HSReplay deste
verisinin `RANKED_STANDARD` yanıtlarında görülen setlerden türetilir. HSReplay
verisi yoksa format filtresi yalnızca destenin kendi `format` alanına bakar.

### Koleksiyon

HSReplay'den oturum çereziyle çekilir. Çerez yalnızca `hsreplay.net` adresine
gönderilir ve hiçbir günlüğe yazılmaz.

Varsayım (doğrulanmadı): uç nokta
`GET https://hsreplay.net/api/v1/collection/?region=<bölge>&account_lo=<hesap>`
ve yanıtta `dbfId` → sürüm bazında adet dizisi.

Core setindeki kartlar her hesapta ücretsiz olduğu için, koleksiyon yanıtında
bulunmasalar bile tam adet sahip sayılır.

### Meta desteler

İki adaptör aynı arayüzü uygular: `fetch()` → deste listesi.

- `decks-hsreplay`: kazanma oranı ve maç sayısıyla birlikte desteler ve
  arketip adları. Varsayım (doğrulanmadı): uç noktalar
  `GET https://hsreplay.net/analytics/query/list_decks_by_win_rate_v2/?GameType=RANKED_STANDARD`
  (ve `RANKED_WILD`) ile `GET https://hsreplay.net/api/v1/archetypes/`.
- `decks-pasted`: kullanıcının yapıştırdığı deste kodları. Ağa çıkmaz, her
  zaman çalışır. Kazanma oranı taşımaz.

Yeni bir site eklemek, aynı arayüzü uygulayan yeni bir dosya eklemektir.

### Güncelleme

`POST /api/update` üç kaynağı sırayla çalıştırır. Her kaynak bağımsızdır:

- Başarılı olursa dosyası atomik olarak değiştirilir (geçici dosyaya yaz, sonra
  yeniden adlandır) ve `status.json` güncellenir.
- Başarısız olursa eski dosyaya dokunulmaz, hata `status.json` içine yazılır ve
  diğer kaynaklar çalışmaya devam eder.
- Yanıt biçimi beklenenle uyuşmuyorsa bu bir hatadır; eksik ya da bozuk veri
  diske yazılmaz.
- Her istek zaman aşımına sahiptir.

Arayüz, kaynak başına son başarılı güncelleme zamanını ve varsa son hatayı
gösterir. HSReplay çerezinin süresi dolmuşsa hata metni bunu ve çerezin nasıl
yenileneceğini söyler.

## Deste kodu

Blizzard'ın deste kodu biçimi `src/deckstring.js` içinde uygulanır: base64
içinde varint dizisi; sürüm, format, kahraman ve adede göre gruplanmış `dbfId`
listeleri. İki işlev: `decode(kod)` ve `encode(deste)`. Bilinen gerçek deste
kodlarıyla gidiş-dönüş testi yapılır.

Geçerlilik denetimi: 30 kart; kart başına en fazla 2, efsanevide en fazla 1;
her kart destenin sınıfından ya da nötr; Standard destede yalnızca Standard
setleri. Kuralı değiştiren kartlar (ör. 40 kartlık deste) desteklenmez; böyle
bir deste "doğrulanamadı" olarak işaretlenir ve gizlenmez.

## Öneri motoru

Her deste için:

1. **Eksikler.** Destedeki her kart için `istenen adet - sahip olunan adet`.
2. **Toz maliyeti.** Eksik kopyaların üretim maliyeti toplamı: sıradan 40,
   nadir 100, epik 400, efsanevi 1600. Üretilemeyen kartlar (Core) maliyete
   girmez.
3. **Durum.** `kurulabilir` (eksik yok), `ikameli` (ikamelerle tamamlanabiliyor
   ve güven seviyesi düşük değil), `eksik` (diğerleri).

Sıralama:

1. `kurulabilir` desteler, kazanma oranına göre azalan.
2. `ikameli` desteler, önce güven seviyesine, sonra kazanma oranına göre.
3. `eksik` desteler, toz maliyetine göre artan.

Kazanma oranı olmayan desteler kendi grubunun sonunda yer alır. Maç sayısı
düşük olan (eşik: 200 maç) destelerin kazanma oranı sıralamada kullanılmaz ve
arayüzde "az veri" olarak işaretlenir.

Filtreler: format, sınıf, en fazla toz maliyeti.

## İkame ve güven seviyesi

### İkame adayları

Eksik her kart için adaylar: oyuncunun sahip olduğu, destede olmayan (ya da
kopya sınırına ulaşmamış), destenin sınıfından ya da nötr, formata uygun
kartlar. Aday puanı şu sinyallerin toplamıdır:

- Mana maliyeti yakınlığı (aynı maliyet en yüksek puan).
- Aynı kart türü (minyon, büyü, silah, mekân).
- Ortak mekanik, ırk ya da büyü okulu.
- Kartın, o sınıfın `decks.json` içindeki diğer destelerinde görülme sıklığı.

En yüksek puanlı aday seçilir; arayüz ilk üç adayı gösterir ve oyuncu
değiştirebilir.

### Çekirdek kart

Bir kartın çekirdek olup olmadığı veriden çıkarılır: aynı arketipteki destelerin
en az %90'ında bulunan kart çekirdektir. Arketipte tek deste varsa çekirdek
bilgisi yoktur ve güven seviyesi en fazla `orta` olabilir.

### Güven seviyesi

| Seviye | Koşul |
|---|---|
| `yüksek` | En fazla 2 kart değişti ve hiçbiri çekirdek değil |
| `orta` | En fazla 5 kart değişti ve hiçbiri çekirdek değil |
| `düşük` | Çekirdek bir kart eksik ya da 5'ten fazla kart değişti |

Güven seviyesi bir tahmindir, ölçüm değildir; arayüz bunu açıkça söyler ve
hangi kartların değiştiğini, hangilerinin çekirdek olduğunu gösterir.

## API

| Yol | İş |
|---|---|
| `GET /api/state` | Kaynak durumları, kart ve deste sayıları |
| `POST /api/update` | Kaynakları güncelle, kaynak bazında sonuç döndür |
| `GET /api/recommendations?format=&class=&maxDust=` | Sıralı öneri listesi |
| `POST /api/decks` | Yapıştırılan deste kodunu doğrula ve ekle |
| `DELETE /api/decks/:id` | Yapıştırılmış bir desteyi sil |
| `POST /api/deckstring` | Kart listesinden deste kodu üret ve geçerliliği denetle |

Tüm girdiler sunucuda doğrulanır: deste kodu çözülemiyorsa ya da bilinmeyen
`dbfId` içeriyorsa istek 400 ile reddedilir. Sunucu yalnızca `127.0.0.1`
adresine bağlanır ve durum değiştiren isteklerde `Origin` başlığını denetler.

## Arayüz

Tek sayfa, düz HTML ve JavaScript.

- Üstte: format ve sınıf filtresi, toz sınırı kaydırıcısı, "Güncelle" düğmesi ve
  kaynak durumları.
- Deste kartları: ad, sınıf, kazanma oranı ve maç sayısı, durum, güven seviyesi,
  toz maliyeti, "deste kodunu kopyala".
- Deste ayrıntısı: kart listesi; eksik kartlar ve seçilen ikameler vurgulanır;
  her kart için "değiştir" seçeneği sahip olunan uygun kartları listeler.
  Değişiklikten sonra kod yeniden üretilir.
- "Deste kodu yapıştır" alanı.

Klavye ile kullanılabilir; durum ve güven bilgisi yalnızca renkle verilmez.

## Test

`node:test` ile, ağ erişimi gerektirmeden:

- `deckstring`: bilinen kodlarla çözme, üretme ve gidiş-dönüş; bozuk girdide
  hata.
- `recommend`: eksik kart ve toz hesabı, durum ataması, sıralama, filtreler,
  düşük maç sayısı kuralı.
- `substitute`: aday seçimi, kopya sınırları, çekirdek kart tespiti, güven
  seviyesi sınırları.
- Kaynaklar: `test/fixtures/` altındaki kayıtlı yanıtlarla ayrıştırma; bozuk
  yanıtta eski verinin korunması.
- `update`: bir kaynak başarısızken diğerlerinin güncellenmesi.

## Riskler ve ilk doğrulama

HSReplay uç noktaları resmi değildir ve geliştirme makinesinden görülemedi.
Uygulama planının ilk adımı, Windows makinede şu ikisini doğrulamak ve gerçek
yanıtları `test/fixtures/` altına kaydetmektir:

1. Koleksiyon uç noktası oturum çereziyle yanıt veriyor mu, biçimi ne?
2. Deste listesi uç noktası ücretsiz hesapla yanıt veriyor mu, biçimi ne?

Sonuca göre:

- Deste uç noktası çalışmıyorsa: yapıştırma adaptörü tek kaynak olarak kalır ve
  başka bir sitenin adaptörü ayrı bir iş olarak değerlendirilir. Kazanma oranı
  olmadan sıralama yalnızca kurulabilirliğe dayanır.
- Koleksiyon uç noktası çalışmıyorsa: arayüze elle koleksiyon işaretleme
  eklenir. Bu, bu tasarımda yoktur ve ayrı bir onay gerektirir.

Uç nokta adresleri ve yanıt biçimleri doğrulandıktan sonra bu belge güncellenir.
