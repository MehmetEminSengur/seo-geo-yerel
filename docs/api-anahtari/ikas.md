# İkas API bilgileri nasıl alınır?

> **Durum:** İkas desteği **okuma + dışa aktarma** şeklindedir ve henüz gerçek bir mağazada **test
> edilmedi**. İkas'ın ürün güncelleme API'si, ürünün tüm varyantlarını (fiyat, stok) her seferinde
> baştan göndermeyi istiyor; eksik bir gönderim bu bilgileri bozabilir. Bu yüzden sistem mağazaya
> yazmaz. Yeni metinleri `data/export/` klasörüne panele yapıştırmaya hazır dosyalar olarak bırakır.

## Adımlar

1. İkas yönetim paneli → **Ayarlar** → **Uygulamalar / Özel Uygulamalar (Private App)** → yeni uygulama.
2. İzinlerden **ürünleri okuma** (`read_products`) ve **kategorileri okuma** iznini seçin.
3. Kaydettiğinizde **Client ID** ve **Client Secret** oluşur.
4. `.env` dosyasına **kendiniz** yazın:
   ```
   IKAS_CLIENT_ID=...
   IKAS_CLIENT_SECRET=...
   ```
5. `config.json` → `store.platform: "ikas"`, `store.domain: "magazaniz.myikas.com"`,
   `store.publicUrl`: müşterilerin gördüğü adres.
6. Kontrol: `node bin/seo-geo.mjs kontrol`

Resmî belge: https://ikas.dev/docs/api/getting-started/authentication
