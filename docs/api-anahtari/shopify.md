# Shopify API anahtarı nasıl alınır?

Shopify, 1 Ocak 2026'dan beri mağaza panelinde yeni "özel uygulama" açtırmıyor. Yeni yol
**Dev Dashboard**: orada kendi uygulamanızı açar, mağazanıza kurar ve iki bilgi alırsınız:
**Client ID** ve **Client Secret**. Sistem bunlarla her gün kendine yeni bir erişim anahtarı alır;
sizin bir şey yapmanız gerekmez.

> Shopify bu ekranları sık güncelliyor. Adımların adı biraz farklı görünürse aynı mantıkla ilerleyin.
> Resmî belge: https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens

## Adımlar

1. Mağaza sahibi hesabıyla **dev.shopify.com** adresine girin (Shopify admin → Ayarlar → Uygulamalar →
   "Uygulama geliştir" bağlantısı da buraya götürür).
2. **Create app** (Uygulama oluştur) → bir ad verin, ör. `seo-geo-yerel`.
3. **Access / Erişim** sekmesinde şu izinleri (scopes) seçin:
   - `read_products`, `write_products`: ürün ve kategori açıklamaları
   - `read_content`, `write_content`: blog yazıları
   - `read_files`, `write_files`: blog kapak görseli yükleme
   - `read_online_store_navigation`: menü (kategori ilişkileri için; isteğe bağlı)
4. Sürümü kaydedip yayınlayın (**Release**), sonra **Install app** ile mağazanıza kurun.
5. **Settings / Ayarlar** sekmesinden **Client ID** ve **Client Secret** değerlerini kopyalayın.
6. Repo klasöründeki `.env` dosyasını açın ve şu iki satırı **kendiniz** doldurun:
   ```
   SHOPIFY_CLIENT_ID=...
   SHOPIFY_CLIENT_SECRET=...
   ```
   Bu değerleri sohbete yapıştırmayın.
7. `config.json` → `store.domain` alanına mağazanın `xxx.myshopify.com` adresini yazın.
8. Kontrol: `node bin/seo-geo.mjs kontrol` → "Bağlandı: … ürün, … kategori" satırı görünmeli.

## 2026'dan önce açılmış özel uygulamanız varsa

Eski usul özel uygulamalar çalışmaya devam ediyor. O uygulamanın **Admin API access token**
değerini (`shpat_…` ile başlar) `.env` içinde `SHOPIFY_ADMIN_TOKEN=` satırına yazmanız yeterli;
izinler yukarıdakiyle aynı olmalı.

## Sık karşılaşılanlar

- **`app_not_installed`**: Uygulama mağazaya kurulmamış ya da mağaza ile uygulama aynı Shopify
  organizasyonunda değil. Uygulamayı mağaza sahibinin hesabıyla açın ve mağazaya kurun.
- **`Access denied … write_products`**: 3. adımdaki izin seçilmemiş. İzni ekleyip yeni sürümü
  yayınlayın ve uygulamayı güncelleyin.
- **Anahtarsız deneme**: Önce sistemi görmek isterseniz `config.json` → `"platform": "shopify-public"`
  yapın. Sistem mağazanızı herkese açık sayfalardan okur, taslakları üretir ama mağazaya yazmaz.
