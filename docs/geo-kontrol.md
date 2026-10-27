# geo-kontrol: botlar sitenize girebiliyor mu?

Metin ne kadar iyi olursa olsun, ChatGPT'nin ya da Google'ın botu sayfanızı okuyamıyorsa yapay zekâ
cevaplarında görünmezsiniz. Bu komut bunu kontrol eder. Mağazaya hiçbir şey yazmaz.

```
node bin/seo-geo.mjs geo-kontrol
node bin/seo-geo.mjs geo-kontrol --url https://www.magazam.com/products/bir-urun
```

Önce `preview` ya da `sync` çalıştırırsanız her sayfa tipinden (ürün, kategori, blog) bir örnek de
kontrol edilir. Yoksa yalnız ana sayfaya bakılır; `--url` ile istediğiniz sayfayı ekleyebilirsiniz.

## Neye bakıyor?

**1. robots.txt.** Sitenizin hangi botlara kapıyı açtığı. İki tür bot var:

| Bot | Ne için | Kapalıysa |
|---|---|---|
| Googlebot, Bingbot | Google, Bing, yapay zekâ özetleri, Copilot | ✗ sorun |
| OAI-SearchBot, ChatGPT-User | ChatGPT arama | ✗ sorun |
| PerplexityBot, Claude-SearchBot | Perplexity ve Claude arama | ✗ sorun |
| GPTBot, ClaudeBot, Google-Extended | Model eğitimi | · sizin tercihiniz |

Eğitim botlarını kapatmak arama cevaplarında görünmenizi engellemez. Açıp açmamak sizin kararınız.

**2. Güvenlik duvarı.** Bazı güvenlik duvarları (özellikle Cloudflare) yapay zekâ botlarını robots.txt'ye
bakmadan engelleyebilir. Komut ana sayfayı bir de bot kimliğiyle açmayı dener. Bu test sizin
bilgisayarınızdan yapıldığı için kesin değildir; ✗ çıkarsa paneldeki ayara bakın.

**3. Şema (JSON-LD).** Sayfanın makine için yazılmış kimlik kartı. ChatGPT, Claude ve Perplexity botları
JavaScript çalıştırmaz; şemanın sayfanın **ilk HTML'inde** olması gerekir. Komut tam olarak bunu
okur: JavaScript çalışmadan gelen HTML'i.

- Ürün sayfasında `Product`, blog yazısında `Article` / `BlogPosting` beklenir.
- Kategori şeması çoğu temada yoktur; eksikliği hata sayılmaz.
- Sistem bir sayfaya SSS eklediyse, `FAQPage` şemasının yayındaki sayfada da göründüğü kontrol edilir.

**4. llms.txt.** Yalnız bilgi verir. Botların bu dosyayı okuduğuna dair güçlü bir kanıt yok.

## ✗ çıkarsa ne yapmalı?

**Mağaza şifre korumalı.** Shopify'da mağaza henüz yayına açılmamışsa her adres şifre ekranına gider;
botlar da yalnız onu görür. Mağazayı yayına açınca komutu tekrar çalıştırın.

**Bir arama botu robots.txt'de kapalı.**
- Shopify: Admin → Online Mağaza → Temalar → Kodu düzenle → `robots.txt.liquid`. Bu dosya yoksa
  Shopify'ın varsayılan robots.txt'si kullanılıyordur ve arama botlarını kapatmaz; biri sonradan
  eklemiş demektir. İlgili `Disallow` satırını kaldırın.
- Diğer altyapılar: robots.txt ayarı genelde SEO ayarları altındadır. Bulamazsanız altyapınızın
  destek ekibine "OAI-SearchBot ve PerplexityBot'un engelini kaldırmak istiyorum" diye yazın.
- robots.txt'de "Cloudflare Managed" yazan bir bölüm varsa o satırları Cloudflare yazıyor; aşağıya bakın.

**Güvenlik duvarı bot kimliğini engelliyor.** Siteniz kendi Cloudflare hesabınızdan geçiyorsa Cloudflare
panelinde yapay zekâ botlarıyla ilgili ayara ("AI Crawl Control" / AI bot engelleme) bakın; arama
botlarına izin verin. Shopify mağazalarında bu ayar Shopify'ın elindedir.

**Ürün ya da blog şeması yok.** Şemayı tema ekler. Shopify'ın resmî temaları ürün ve blog şemasını
ekler; eski ya da özel bir tema eklemiyor olabilir. Tema geliştiricinize ya da altyapı desteğine
"ürün sayfalarına Product JSON-LD şeması eklensin" diye yazın.

**Sistemin eklediği SSS şeması yayında yok.** Platform açıklama alanındaki `<script>` etiketini siliyor
demektir. SSS metni sayfada yine görünür; yalnız makine için işaretlenmemiş olur. Bunu rapor edin,
şema ekleme yolunu altyapınıza göre birlikte bulalım.
