# Stoner

Hearthstone koleksiyonunuza bakarak güncel meta destelerden hangilerini kurabileceğinizi söyleyen,
eksik kartları elinizdeki kartlarla tamamlayan yerel bir web uygulaması.

Uygulama oyuna dokunmaz. Yalnızca öneri üretir ve deste kodu verir; desteyi oyuna siz yapıştırır,
maçları siz oynarsınız.

## Gerekenler (Windows)

1. **Node.js 22 veya üstü.** <https://nodejs.org> adresinden LTS sürümünü kurun.
2. **Hearthstone Deck Tracker**, HSReplay.net hesabınıza bağlı ve koleksiyon yüklemesi açık.
   Oyunda koleksiyon ekranını bir kez açtığınızda kartlarınız HSReplay'e yüklenir.

## Kurulum

1. Bu depoyu indirin (GitHub'da **Code → Download ZIP**) ve bir klasöre açın.
2. Klasörde `config.local.json` adında bir dosya oluşturun (ayrıntı aşağıda):

   ```json
   {
     "hsreplay": {
       "sessionid": "BURAYA_CEREZ_DEGERI"
     }
   }
   ```

3. Çerez değerini almak için: tarayıcıda <https://hsreplay.net> adresine giriş yapın, `F12` ile
   geliştirici araçlarını açın, **Application → Cookies → https://hsreplay.net** altında
   `sessionid` satırının değerini kopyalayıp yukarıdaki dosyaya yapıştırın.

4. Dosyayı Not Defteri ile şöyle oluşturun: **Dosya → Farklı Kaydet**, **Kayıt türü: Tüm Dosyalar**,
   dosya adı `config.local.json`, **Kodlama: UTF-8**. "Tüm Dosyalar" seçilmezse Not Defteri dosyayı
   `config.local.json.txt` olarak kaydeder ve uygulama dosyayı bulamaz.
5. Dosya adını doğru görmek için Gezgin'de **Görünüm → Göster → Dosya adı uzantıları** seçeneğini açın;
   adın sonunda `.txt` görüyorsanız dosyayı yeniden adlandırıp o bölümü silin.

Bu çerez hesabınıza giriş anahtarıdır: kimseyle paylaşmayın. Dosya yalnızca bilgisayarınızda durur,
git'e girmez ve yalnızca hsreplay.net adresine gönderilir.

## İlk çalıştırma: bağlantı denetimi

Klasörü Gezgin'de açın, adres çubuğuna `cmd` yazıp Enter'a basın (klasörde bir komut istemi açılır) ve
şunu çalıştırın:

```
node scripts/probe-hsreplay.js
```

Koleksiyon ve deste denemelerinde `Ayrıştırma: OK ...` satırını, diğerlerinde bir "Biçim" bölümünü
görüyorsanız her şey hazır. Herhangi bir yerde `BAŞARISIZ` görürseniz ekrandaki "Biçim" ve "Ayrıştırma"
satırlarını geliştiriciye iletin (bu satırlar kişisel veri içermez).

## Kullanım

1. `start.bat` dosyasına çift tıklayın. Tarayıcıda `http://127.0.0.1:4717` açılır.
2. **Güncelle**'ye basın. Kartlar, koleksiyonunuz ve meta desteler indirilir.
3. Listeden bir deste seçip **Deste kodunu kopyala**'ya basın.
4. Hearthstone'da yeni deste oluşturun; oyun panodaki kodu kendiliğinden algılar.

Yeni bir genişleme ya da denge yaması çıktığında yapmanız gereken tek şey yeniden **Güncelle**'ye
basmaktır. Yeni paket açtıysanız önce oyunda koleksiyon ekranını bir kez açın.

Kapatmak için siyah pencerede `Ctrl+C` tuşlarına basın ya da pencereyi kapatın.

## Listeyi okumak

- **Hemen kurulabilir:** bütün kartlar sizde var.
- **İkameyle kurulabilir:** eksik kartlar elinizdeki benzer kartlarla değiştirildi. Güven seviyesi
  bir tahmindir: kaç kartın değiştiğine ve değişenlerin destenin çekirdeği olup olmadığına bakar.
- **Kart eksik:** deste, üretmeniz gereken toz miktarıyla birlikte gösterilir.
- **Az veri:** 200 maçtan az oynanmış destelerin kazanma oranı sıralamada kullanılmaz.

Başka bir siteden ya da arkadaşınızdan aldığınız deste kodunu **Deste kodu ekle** alanına
yapıştırabilirsiniz.

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| "HSReplay oturumu reddetti" | Çerezin süresi dolmuş. Yeni `sessionid` değerini `config.local.json` dosyasına yazın. |
| "HSReplay'e bağlanılamadı" | Ağınız hsreplay.net adresini engelliyor olabilir. Başka bir ağda deneyin. |
| "config.local.json bulunamadı ya da içinde hsreplay.sessionid yok" | Dosya yok, yanlış klasörde ya da adı `config.local.json.txt`. Kurulum bölümündeki Not Defteri adımlarına bakın. |
| "region ve accountLo yazın" | Yalnızca uygulama isterse gerekir. `region`: 1 Amerika, 2 Avrupa, 3 Asya. `accountLo`: HSReplay koleksiyon sayfasının adresindeki sayı. İkisini de `hsreplay` bölümüne ekleyin. |
| "Port 4717 kullanımda" | Uygulama zaten açık. Tarayıcıda `http://127.0.0.1:4717` adresine gidin. |
| Bir kaynak güncellenemedi | Diğerleri güncellenir; başarısız olan son indirilen veriyle çalışmaya devam eder. |

## Sınırlar

- Deste kurallarını değiştiren kartlar (örneğin 40 kartlık desteler) doğrulanamaz ve uyarıyla gösterilir.
- Kartı elle değiştirdiğiniz destelerde yan deste (sideboard) bilgisi korunmaz.
- HSReplay'in kullandığımız adresleri resmi değildir; site değişirse güncelleme bozulabilir.
  O durumda deste kodu yapıştırma yolu çalışmaya devam eder.

## Geliştirme

```
npm test
```

Çalışma zamanı bağımlılığı yoktur. Tasarım: `docs/superpowers/specs/2026-11-12-deck-recommender-design.md`.
