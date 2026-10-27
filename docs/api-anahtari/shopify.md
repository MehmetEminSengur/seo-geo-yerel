# Shopify bağlantısı

Shopify'da anahtar almanıza gerek yok. Sistem Shopify'ın kendi komut satırı aracıyla (Shopify CLI)
bağlanır; siz tarayıcıda yalnız bir kez **Yükle**'ye basarsınız.

## Bağlanma (önerilen yol)

1. `config.json` → `store.domain` alanına mağazanın `xxx.myshopify.com` adresini yazın
   (Shopify admin → Ayarlar → Alan adları'nda görünür). `store.auth` alanı `"cli"` kalsın.
2. Şu komutu çalıştırın:
   ```
   node bin/seo-geo.mjs shopify-baglan
   ```
   Shopify CLI kurulu değilse önce kendisi kurar (bir kez, 1-2 dakika).
3. Tarayıcıda Shopify açılır. **Mağaza sahibi hesabıyla** giriş yapın ve izin ekranında **Yükle**'ye
   basın. Bunu 4 dakika içinde yapın; süre dolarsa komutu tekrar çalıştırmanız yeterli.
4. Kontrol: `node bin/seo-geo.mjs kontrol` → "Bağlandı: … ürün, … kategori" satırı görünmeli.

İstenen izinler: ürün ve kategori açıklamaları (`write_products`), blog yazıları (`write_content`),
blog kapak görseli (`write_files`) ve menü okuma (`read_online_store_navigation`). Yazma izni okumayı
da kapsar. Sistem yine de hiçbir sayfayı önizleme ve sizin onayınız olmadan değiştirmez.

**Bağlantı ne kadar dayanır?** Erişim anahtarı 24 saat geçerli. Süresi dolunca Shopify CLI tarayıcı
açmadan kendisi yeniler; bilgisayar birkaç gün kapalı kalsa da açılınca devam eder. Yenileme bir gün
düşerse sistem hiçbir şeyi bozmaz: işler güvenli durumda bekler ve `kontrol` size
`shopify-baglan` komutunu tekrar çalıştırmanızı söyler.

### Sık karşılaşılanlar

- **Tarayıcıda "Unauthorized Access"**: Tarayıcıda açık olan Shopify hesabının bu mağazada yetkisi
  yok. Çoğunlukla başka bir mağazanın hesabıyla girilmiştir. Doğru hesapla giriş yapıp komutu tekrar
  çalıştırın; hesabı değiştirmek istemiyorsanız gizli pencere kullanabilirsiniz.
- **"Timed out waiting for OAuth callback"**: İzin 4 dakika içinde verilmedi. Komutu tekrar çalıştırın.
- **`npm install` izin hatası**: Shopify CLI'ı elle kurun: `npm install -g @shopify/cli@4`
  (gerekirse Node.js'i nodejs.org'dan yeniden kurmak sorunu çözer).

## Kesintisiz çalışma için: uygulama anahtarı (isteğe bağlı)

Sistemin hiçbir zaman tarayıcıda onay istememesini istiyorsanız (ör. aylarca kendi kendine
çalışacaksa) Dev Dashboard'da kendi uygulamanızı açıp anahtar alabilirsiniz. Daha uğraştırıcıdır
ama hiç süresi dolmaz.

> Resmî belge: https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens

1. Mağaza sahibi hesabıyla **dev.shopify.com** adresine girin.
2. **Create app** → bir ad verin, ör. `seo-geo-yerel`.
3. **Access / Erişim** sekmesinde yukarıdaki izinleri seçin (`read_products`, `write_products`,
   `read_content`, `write_content`, `read_files`, `write_files`, `read_online_store_navigation`).
4. Sürümü yayınlayın (**Release**), sonra **Install app** ile mağazanıza kurun.
5. **Settings** sekmesinden **Client ID** ve **Client Secret** değerlerini kopyalayın.
6. `.env` dosyasına şu iki satırı **kendiniz** yazın (sohbete yapıştırmayın):
   ```
   SHOPIFY_CLIENT_ID=...
   SHOPIFY_CLIENT_SECRET=...
   ```
7. `config.json` → `store.auth` değerini `"app"` yapın ve `kontrol` çalıştırın.

1 Ocak 2026'dan önce açılmış eski bir özel uygulamanız varsa onun `shpat_…` ile başlayan
**Admin API access token** değerini `.env` içinde `SHOPIFY_ADMIN_TOKEN=` satırına yazmanız yeterli.

- **`app_not_installed`**: Uygulama mağazaya kurulmamış ya da mağaza ile uygulama aynı Shopify
  organizasyonunda değil.
- **`Access denied … write_products`**: 3. adımdaki izin seçilmemiş. İzni ekleyip yeni sürümü
  yayınlayın ve uygulamayı güncelleyin.

## Bağlanmadan önce görmek isterseniz

`config.json` → `"platform": "shopify-public"` yapın. Sistem mağazanızı herkese açık sayfalardan okur,
taslakları üretir ama mağazaya yazmaz.
