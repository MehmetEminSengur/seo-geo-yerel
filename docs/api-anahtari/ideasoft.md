# IdeaSoft API bilgileri nasıl alınır?

> **Durum:** IdeaSoft desteği **okuma + dışa aktarma** şeklindedir ve henüz gerçek bir mağazada
> **test edilmedi**. Sistem ürün ve kategorilerinizi API'den okur, yeni metinleri üretir ve
> `data/export/` klasörüne panele yapıştırmaya hazır dosyalar olarak bırakır. Mağazaya kendisi yazmaz.

## 1. API uygulaması oluşturun

1. IdeaSoft yönetim paneli → üst menüde **Entegrasyonlar** → **API**.
2. Yeni bir API uygulaması ekleyin; izin olarak **okuma** yeterli.
3. **Yönlendirme adresi (Redirect URI)** olarak tam olarak şunu yazın:
   ```
   http://127.0.0.1:8787/callback
   ```
4. Kaydettiğinizde **Client ID** ve **Client Secret** oluşur.

API bölümünü yalnızca tek bir yönetici kullanıcı görebilir. Göremiyorsanız mağazanın ana yönetici
hesabıyla girin. Sorun yaşarsanız IdeaSoft API desteği: apisupport@ideasoft.com.tr

## 2. Anahtarları .env dosyasına yazın

```
IDEASOFT_CLIENT_ID=...
IDEASOFT_CLIENT_SECRET=...
```

`config.json` → `store.platform: "ideasoft"`, `store.domain: "magazaniz.myideasoft.com"`.

## 3. İlk bağlantı (bir kez)

```
node bin/seo-geo.mjs ideasoft-baglan
```

Komut bir adres verir. Tarayıcıda açıp izin verin; "bağlantı kuruldu" yazısını görünce pencereyi
kapatabilirsiniz. Bundan sonra sistem bağlantıyı kendisi yeniler.

IdeaSoft her yenilemede yeni bir anahtar verir ve eskisini geçersiz kılar. Sistem yeni anahtarı
önce diske kaydeder; bilgisayar tam o anda kapansa bile açılışta anahtar kurtarılır.
