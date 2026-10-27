# Ajan talimatları: seo-geo-yerel kurulumu

Bu dosya, kullanıcının yapay zekâ ajanı (Codex, Claude Code, Antigravity) için yazıldı. Kullanıcı
"bunu mağazama kur" dediğinde aşağıdaki akışı **sırayla** izle. Kullanıcı teknik biri değil; kısa,
sade Türkçe konuş, her adımda ne yaptığını tek cümleyle söyle.

## Değişmez kurallar

1. **Gizli bilgileri sohbete yazdırma.** API anahtarlarını kullanıcıdan sohbete yapıştırmasını
   isteme. `.env.example` dosyasını `.env` olarak kopyala, kullanıcıdan anahtarları **dosyaya
   kendisinin** yazmasını iste. `.env` içeriğini ekrana basma, loglama, commit etme.
2. **Mağazaya onaysız yazma.** İlk çalıştırma her zaman `preview`. Kullanıcı önizleme raporunu
   görüp onay vermeden `approve` / `apply` çalıştırma. `config.json` → `"mode": "approval"`
   varsayılan kalır; `"auto"` moduna ancak kullanıcı açıkça isterse geç.
3. **Kodu değiştirme.** Kurulum için `config.json`, `brand-facts.json`, `.env` dışında dosya
   düzenleme. Bir hata görürsen kullanıcıya anlat; kodu kendin "düzeltmeye" çalışma.
4. **Komutlar:** her şey `node bin/seo-geo.mjs <komut>` ile çalışır. `node bin/seo-geo.mjs yardim`
   tam listeyi verir. Node.js 22 veya üstü gerekir (`node -v`).

## Kurulum akışı

### Adım 0: Ön kontrol
- Bu dosyayı GitHub'dan okuyorsan ve repo henüz bilgisayarda yoksa: önce `README.md` en üstündeki
  "Yapay zekâ ajanı için" adımlarıyla repoyu `~/seo-geo-yerel` klasörüne indir ve o klasörde devam et.
- `node -v` → 22'den küçükse ya da Node yoksa kullanıcıya nodejs.org'dan LTS sürümünü kurmasını
  söyle (kurulum bitince sana "tamam" desin) ve bekle.
- `cp config.example.json config.json`, `cp brand-facts.example.json brand-facts.json`,
  `cp .env.example .env` (Windows'ta `copy`).

### Soru 1: Mağaza adresi ve altyapı
"Mağazanızın adresi ne ve hangi altyapıyı kullanıyorsunuz (Shopify, IdeaSoft, İkas)?"

- `config.json` → `store.platform`, `store.domain`, `store.publicUrl`, `store.brandName`.
  - Shopify: `platform: "shopify"`, `domain: "<magaza>.myshopify.com"` (Shopify admin → Ayarlar →
    Alan adları'nda görünür), `publicUrl`: müşterinin gördüğü adres.
  - IdeaSoft: `platform: "ideasoft"`, `domain: "<magaza>.myideasoft.com"`.
  - İkas: `platform: "ikas"`, `domain: "<magaza>.myikas.com"`.
- **Shopify ise anahtar isteme.** `store.auth: "cli"` kalsın ve `node bin/seo-geo.mjs shopify-baglan`
  çalıştır. Komut Shopify CLI'ı gerekirse kendisi kurar ve tarayıcıda Shopify'ın izin ekranını açar.
  Kullanıcıya tek cümleyle söyle: "Tarayıcıda Shopify açılacak; mağaza sahibi hesabıyla girip
  Yükle'ye basın, 4 dakikanız var." Okuma ve yazma izinleri birlikte istenir; ayrıca izin sorma.
  Tarayıcıda "Unauthorized Access" çıkarsa açık olan hesap başka bir mağazanındır: doğru hesapla
  (ya da gizli pencerede) girip komutu tekrar çalıştırın. Kullanıcı sistemin aylarca hiç onay
  istemeden çalışmasını isterse uygulama anahtarı yolu `docs/api-anahtari/shopify.md` → "Kesintisiz
  çalışma için" bölümünde.
- IdeaSoft ve İkas için API anahtarının nasıl alınacağını ilgili rehberden **adım adım** anlat:
  `docs/api-anahtari/ideasoft.md`, `ikas.md`. Kullanıcı anahtarları `.env` dosyasına kendisi yazsın.
- Kullanıcı önce sistemi anahtarsız denemek isterse ve mağaza Shopify ise:
  `platform: "shopify-public"` (salt-okunur önizleme; mağazaya yazamaz, sonuçları dosya olarak verir).
- IdeaSoft ve İkas şu an **yalnız okuma + dışa aktarma** destekler: sistem metinleri hazırlar,
  `data/export/` klasörüne kopyala-yapıştır dosyası yazar; kullanıcı panele kendisi yapıştırır.
  Bunu kullanıcıya açıkça söyle.

### Soru 2: Kelime verisi
"Anahtar kelimeleri ücretsiz Google önerilerinden mi alalım, yoksa DataForSEO hesabınız var mı?
(Yeni DataForSEO hesabına 1 dolar deneme kredisi veriliyor; bitince en az 50 dolar yükleme gerekiyor.)"

- Ücretsiz: `keywords.source: "free"` (varsayılan).
- DataForSEO: `keywords.source: "dataforseo"`; kullanıcı `.env` içine `DATAFORSEO_LOGIN` ve
  `DATAFORSEO_PASSWORD` yazar (dataforseo.com → API Dashboard → API Access). Harcama
  `limits.dataforseo.totalUsd` (varsayılan 1 $) ile sınırlıdır.

### Soru 3: Marka bilgileri
"Metinlerde asla kaybolmaması gereken bilgiler neler? Kuruluş yılınız, ürünleriniz arasındaki
farklar, teslimat gibi. Bir de rakiplerinizin marka adları; onların adına sayfa yazmayalım."

`brand-facts.json`:
- `brandName`, `voice` (ör. "samimi, uzman, sade").
- `isManufacturer`: kullanıcı kendisi üretiyorsa `true`, satıcıysa `false` (false iken "üretici",
  "fabrika" kelimeleri hedef alınmaz).
- `competitors`: rakip marka adları.
- `facts`: her bilgi için `text`. Yıl gibi metinde kalması şart olan bir şey varsa
  `preservePattern` ekle (ör. `"\\b2005\\b"`); eski metinde geçen bu bilgi yeni metinde yoksa
  taslak yayına alınmaz.

### Soru 4: Nereden başlayalım?
"Önce hangi kategorilerle başlayalım? (Hepsi ya da birkaç kategori)"

- `config.json` → `scope.collections`: `"all"` ya da kategori adresleri listesi (ör.
  `["aluminyum-folyo", "streç-film"]`). İlk denemede 1-2 kategori öner.
- `schedule.batchSize`: günde kaç sayfa (varsayılan 5).
- `blog.enabled` / `blog.perWeek`: haftada kaç blog yazısı (varsayılan 2).

### Metin ve görsel motoru
- `engines.text`: senin hangi ajan olduğuna göre: Codex → `"codex"`, Claude Code → `"claude"`,
  Antigravity / Gemini → `"gemini"` (Gemini CLI kurulu olmalı). Bu, kullanıcının kendi aboneliğidir;
  ek API ücreti yoktur.
- `engines.image` (blog kapak görseli):
  - `"product-image"` (varsayılan): konuya en yakın ürünün mevcut görseli. Ücretsiz.
  - `"agent-queue"`: Codex ve Antigravity kullanıcıları için; görseli SEN üretirsin (aşağıda).
  - `"api"`: `.env` içinde `OPENAI_API_KEY` ya da `GEMINI_API_KEY` ile otomatik üretim.

### Adım 5: Kontrol ve önizleme
1. `node bin/seo-geo.mjs kontrol` → tüm satırlar ✓ olana kadar eksikleri kullanıcıyla tamamla.
2. `node bin/seo-geo.mjs preview` → mağazayı okur, kelimeleri toplar, taslakları üretir.
   **Mağazaya hiçbir şey yazmaz.** Birkaç dakika sürebilir.
3. Raporu kullanıcıya aç: `data/rapor/onizleme.html` (macOS `open`, Windows `start`).
   Her sayfa için önce/sonra, Google'da nasıl görüneceği ve uyarılar orada.
4. Kullanıcı onaylarsa: `node bin/seo-geo.mjs approve <numaralar>` ya da `approve --hepsi`,
   ardından `node bin/seo-geo.mjs apply`. Sistem önce yedek alır, sonra yazar, sonra yayındaki
   sayfayı kontrol eder.
5. Geri almak isterse: `node bin/seo-geo.mjs restore <numara>`.
6. `node bin/seo-geo.mjs geo-kontrol` → yapay zekâ botlarının siteye girebildiğini ve şemaların
   sayfanın ilk HTML'inde olduğunu kontrol eder (mağazaya yazmaz). ✗ satırı varsa kullanıcıya sade
   Türkçeyle anlat ve `docs/geo-kontrol.md` içindeki ilgili düzeltmeyi adım adım göster. Ayarları
   (robots.txt, tema, Cloudflare) kullanıcı kendisi değiştirir; sen değiştirme.

### Adım 6: Otomatik çalışma
Kullanıcı isterse: `node bin/seo-geo.mjs zamanlayici-kur`. Bilgisayar açılınca ve saatte bir
`tick` çalışır. Bilgisayar kapalıyken iş yapılmaz; açılınca yarım kalan işler toparlanır ve
kaçırılan görevler **bir kez** çalışır. Onay modunda yeni taslaklar raporda birikir; kullanıcı
onayladıkça uygulanır. Kaldırmak için `zamanlayici-kaldir`.

## Görsel kuyruğu (engines.image = "agent-queue")

Kullanıcı seninle her oturum açtığında:
1. `node bin/seo-geo.mjs images` → `pending` listesindeki her istek için `prompt`, `alt` ve
   `outFile` alanlarını oku.
2. Görseli kendi görsel üretme aracınla `prompt`'a göre üret (yatay, 1536×1024 civarı, yazı/logo
   yok) ve tam olarak `outFile` yoluna PNG olarak kaydet.
3. Tekrar `node bin/seo-geo.mjs images` → yazı onaya ilerler.
Görsel üretemiyorsan kullanıcıya söyle; `engines.image` değerini `"product-image"` yapabilir.

## Sorun giderme
- `status` → işlerin ve zamanlayıcının durumu.
- `conflict` durumundaki iş: sayfa sistem dışında elle değiştirilmiş; sistem üzerine yazmaz.
  Kullanıcıya rapordan göster, ne yapmak istediğini sor.
- `rejected`: taslak kurallara uymadı (uydurma ölçü, kayıp marka bilgisi, uzun meta...). Neden
  raporda yazar. Tekrar denemek için sayfayı `plan --zorla <adres>` ile yeniden planlayabilirsin.
- Kayıtlar: `data/logs/`.
