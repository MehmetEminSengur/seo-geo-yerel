# seo-geo-yerel

> **Yapay zekâ ajanı için (Codex, Claude Code, Antigravity, Gemini CLI):** Kullanıcı sana bu sayfanın
> linkini verip kurmanı istediyse, sadece bu sayfayı okuyup cevap verme; aşağıdaki adımları
> **kendin uygula**:
> 1. Repoyu kullanıcının bilgisayarına indir. Hedef klasör: kullanıcının ev dizininde `seo-geo-yerel`.
>    - git varsa: `git clone https://github.com/MehmetEminSengur/seo-geo-yerel.git ~/seo-geo-yerel`
>    - git yoksa: `https://github.com/MehmetEminSengur/seo-geo-yerel/archive/refs/heads/main.zip`
>      dosyasını indirip açın (macOS/Linux: `curl -L … -o seo.zip && unzip seo.zip`, Windows PowerShell:
>      `Invoke-WebRequest … -OutFile seo.zip; Expand-Archive seo.zip`), klasörün adını `seo-geo-yerel` yap.
>    - Klasör zaten varsa yeniden indirme; içine gir ve `git pull` ile güncelle.
> 2. O klasöre geç ve `AGENTS.md` dosyasını baştan sona oku.
> 3. Kurulumu `AGENTS.md` → "Kurulum akışı" bölümündeki sırayla başlat: önce Node.js kontrolü, sonra
>    kullanıcıya dört soruyu **teker teker** sor. Mağazaya kullanıcının onayı olmadan hiçbir şey yazma.

E-ticaret mağazanızdaki **ürün, kategori ve blog** sayfalarını Google'a ve yapay zekâ aramalarına
(ChatGPT, Gemini, Google yapay zekâ özeti) hazırlayan, **kendi bilgisayarınızda** çalışan sistem.

- Sunucu kiralamanız gerekmez. Bilgisayarınız kapalıyken bekler, açılınca kaldığı yerden devam eder.
- Metinleri **kendi yapay zekâ aboneliğiniz** yazar (Codex, Claude Code ya da Gemini CLI). Ek API ücreti yoktur.
- Mağazanıza **onayınız olmadan hiçbir şey yazmaz**. Her değişiklikten önce yedek alır; istediğiniz an geri alırsınız.

## En kolay kurulum: linki ajanınıza verin

**Codex**, **Claude Code** ya da **Antigravity**'yi açın ve şunu yazın:

> https://github.com/MehmetEminSengur/seo-geo-yerel bu sistemi mağazama kur.

Başka bir şey indirmenize gerek yok. Ajan repoyu bilgisayarınıza kendisi indirir, `AGENTS.md` dosyasındaki adımları izler ve size dört soru sorar:

1. Mağaza adresiniz ve altyapınız (Shopify, IdeaSoft, İkas). Shopify'da anahtar gerekmez: tarayıcıda tek onayla bağlanır. Diğerlerinde API anahtarının nasıl alınacağını gösterir.
2. Kelime verisi: ücretsiz Google önerileri mi, DataForSEO mu?
3. Asla silinmemesi gereken marka bilgileriniz (kuruluş yılı, ürün farkları) ve rakiplerinizin adları.
4. Hangi kategorilerden başlanacağı.

Sonra bir **önizleme raporu** açar. Raporu inceleyip onay verdiğiniz sayfalar mağazaya yazılır.

## Sistem ne yapar?

| Sayfa | Ne yazılır |
|---|---|
| **Ürün** | Başta kısa cevap bloğu, ürün özellikleri, kullanım alanları, 3-4 sık sorulan soru + şema kodu, kategoriye ve benzer ürüne bağlantı. 180-380 kelime. |
| **Kategori** | Kısa tanım, çeşitler, seçim rehberi, sık sorulan sorular + şema, ilgili kategorilere ve öne çıkan ürünlere bağlantılar. |
| **Blog** | Başlıktaki soruya doğrudan cevap veren kısa paragraf, soru biçiminde ara başlıklar, karşılaştırma tablosu, sık sorulan sorular + şema, ilgili kategoriye ve eski bir yazıya bağlantı, kapak görseli. |
| **Google başlığı ve açıklaması** | Hedef kelime başta, marka adıyla biten başlık; 120-155 karakterlik, tam cümleli, reklam kalıbı içermeyen açıklama. |

### Güvenlik kilitleri

Bunların hepsi gerçek bir mağazada yaşanmış hatalardan geliyor:

- **Niyet süzgeci:** "karton bardakta kek", rakip marka adları, "üretici" gibi kelimeler sayfa hedefi olmaz. "Nedir, nasıl" gibi bilgi soruları bloga gider.
- **Doğru raf:** Genel aramalar kategoriye, ölçü ya da marka içeren aramalar ürüne gider. Kelime yalnızca kendi ürün ailesindeki sayfaya eşlenir.
- **Uydurma yok:** Kaynakta olmayan ölçü, adet ya da sertifika yazan taslak yayına alınmaz.
- **Marka bilgisi korunur:** Eski metinde geçen onaylı bilgi (ör. kuruluş yılı) yeni metinde yoksa taslak yayına alınmaz.
- **42 gün kuralı:** Güncellenen sayfaya, Google'da sonucu ölçülene kadar dokunulmaz.
- **Elle değişikliğe saygı:** Siz bir sayfayı panelden değiştirdiyseniz sistem üzerine yazmaz, size sorar.

### Botlar sitenize girebiliyor mu?

`geo-kontrol` komutu ChatGPT, Perplexity, Claude ve Google botlarının robots.txt'de ve güvenlik duvarında engellenip engellenmediğine, ürün ve blog şemasının sayfanın ilk HTML'inde (bu botlar JavaScript çalıştırmaz) olup olmadığına bakar. Ayrıntı ve düzeltmeler: [docs/geo-kontrol.md](docs/geo-kontrol.md).

## Bilgisayar kapanırsa ne olur?

- Her değişiklik küçük adımlara bölünür ve her adım diske kaydedilir.
- Açılışta yarım kalan iş tespit edilir. Mağazaya yazma gerçekleşmişse ikinci kez yazılmaz; gerçekleşmemişse yeniden denenir.
- Bir hafta kapalı kalsanız bile haftalık görevler açılışta **bir kez** çalışır, üst üste birikmez.
- Bunlar `test/crash-drill.test.mjs` dosyasında gerçek bir süreç öldürme tatbikatıyla sınanır.

## Komutlar

```
node bin/seo-geo.mjs shopify-baglan     # Shopify'a bağlan (tarayıcıda tek onay)
node bin/seo-geo.mjs kontrol            # kurulum kontrolü
node bin/seo-geo.mjs geo-kontrol        # yapay zekâ botları siteye girebiliyor mu, şema yerinde mi?
node bin/seo-geo.mjs preview            # taslakları üret, rapor aç (mağazaya yazmaz)
node bin/seo-geo.mjs approve 3 5        # taslak onayla (approve --hepsi)
node bin/seo-geo.mjs apply              # onaylananları yedekle → yaz → doğrula
node bin/seo-geo.mjs restore 3          # bir değişikliği geri al (blog yazısı taslağa çekilir)
node bin/seo-geo.mjs status             # durum
node bin/seo-geo.mjs zamanlayici-kur    # açılışta ve saatte bir otomatik çalış
```

Tam liste: `node bin/seo-geo.mjs yardim`

## Gereksinimler

- Node.js 22 veya üstü
- Codex CLI, Claude Code ya da Gemini CLI (abonelikle oturum açılmış)
- Mağaza bağlantısı: [Shopify](docs/api-anahtari/shopify.md) (Shopify CLI, tarayıcıda tek onay; gerekirse kendisi kurulur) · [IdeaSoft](docs/api-anahtari/ideasoft.md) · [İkas](docs/api-anahtari/ikas.md)

## Platform desteği

| Platform | Okuma | Mağazaya yazma |
|---|---|---|
| Shopify | ✓ | ✓ ürün, kategori, blog, görsel |
| Shopify (anahtarsız önizleme) | ✓ herkese açık sayfalardan | ✗ dosya olarak verir |
| IdeaSoft | ✓ (test edilmedi) | ✗ dosya olarak verir |
| İkas | ✓ (test edilmedi) | ✗ dosya olarak verir |

Takıldığınız bir yer olursa videonun altına yorum yazın, birlikte bakalım.

## Lisans

MIT — ayrıntılar `LICENSE` dosyasında. Sistem olduğu gibi sunulur; mağazanıza uygulamadan önce önizleme raporunu mutlaka inceleyin.
