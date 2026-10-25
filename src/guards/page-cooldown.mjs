// "Bir sayfa ölçülmeden yeniden yazılmaz." Gerçek bir mağazada karton bardak kategorisi 3 günde 22 kez
// baştan yazıldı; hiçbir sürüm Google'da ölçülemedi. Bekleme süresi Search Console'un 28 günlük
// penceresi + pay = 42 gün. Ayrıca sistemin zaten optimize ettiği sayfa kendiliğinden yeniden
// planlanmaz; ancak elle istenirse (plan --zorla <handle>) yazılır.
export function cooldownOk(page, days, now = Date.now()) {
  if (!page.last_applied_at) return true;
  return now - Date.parse(page.last_applied_at) >= days * 86_400_000;
}

export const optimizedBySystem = (page) => /data-seo-geo="faq"/.test(page.body_html || '');

// Sayfanın ne kadar iyileştirmeye ihtiyacı var? 0 = dokunma.
export function needScore(page) {
  const text = String(page.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let s = 0;
  if (!page.seo_description) s += 3;
  if (!page.seo_title) s += 2;
  if (text.length < 300) s += 2;
  if (!/<blockquote/i.test(page.body_html || '')) s += 1;
  if (page.target_keyword) s += 1;
  return s;
}
