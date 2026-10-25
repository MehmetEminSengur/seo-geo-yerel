// Gerçek bir mağazada yaşanan gerçek hatalar burada test vakası: aynı kelimeler bir daha geçmemeli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRules, classifyKeyword } from '../src/keywords/intent-filter.mjs';
import { familyMatch } from '../src/keywords/text.mjs';
import { chooseTarget, guessPageType } from '../src/keywords/mapper.mjs';
import { classifyUrls } from '../src/keywords/dataforseo.mjs';

const rules = buildRules({ competitors: ['rakipbardak', 'digerbardak', 'ornekambalaj'] });

test('çöp kelimeler elenir: kek, puding, telefon yapımı, kdv, rakip marka, üretici', () => {
  for (const k of ['karton bardakta kek', 'karton bardakta puding', 'karton bardaktan telefon yapımı', 'karton bardak kdv oranı',
    'rakipbardak karton bardak', 'digerbardak karton bardak', 'karton bardak üreticileri', 'streç film zayıflama yorumları']) {
    assert.equal(classifyKeyword(k, rules).route, 'drop', k);
  }
});

test('bilgi niyetli kelimeler silinmez, blog havuzuna gider', () => {
  for (const k of ['alüminyum folyo zararlı mı', 'yağlı kağıt nasıl kullanılır', 'z peçete nedir']) {
    assert.equal(classifyKeyword(k, rules).route, 'blog', k);
  }
});

test('satın alma kelimeleri sayfa hedefi olabilir', () => {
  for (const k of ['alüminyum folyo fiyat', 'toptan karton bardak', 'kapaklı karton bardak']) {
    assert.equal(classifyKeyword(k, rules).route, 'page', k);
  }
});

test('üretici olan marka için "üretici" kelimesi serbest', () => {
  assert.equal(classifyKeyword('karton bardak üreticileri', buildRules({ isManufacturer: true })).route, 'page');
});

test('aile kapısı: havlu kağıt rulosu pos rulosu sayfasına gitmez, ünsüz yumuşaması tanınır', () => {
  assert.equal(familyMatch('Pos Ruloları', 'havlu kağıt rulosundan neler yapılır'), false);
  assert.equal(familyMatch('Alüminyum Folyo', 'streç film 30 cm'), false);
  assert.equal(familyMatch('Çorba Kase ve Kapakları', 'plastik çorba kabı'), true);
  assert.equal(familyMatch('Çorba Kasesi', 'karton çorba kasesi 14 oz'), true);
  assert.equal(familyMatch('Gıda Kapları', 'sızdırmaz gıda kabı'), true);
});

test('sayfa tipi: ölçü içeren kelime ürüne, fiyat/toptan kategoriye', () => {
  assert.equal(guessPageType('30 cm 170 m streç film'), 'product');
  assert.equal(guessPageType('alüminyum folyo fiyat'), 'collection');
});

test('raf seçimi: genel arama kategoriye, tek ürüne değil', () => {
  const pages = [
    { id: 'c1', type: 'collection', title: 'Çorba Kaseleri', menu_path: 'Kaplar > Çorba Kaseleri' },
    { id: 'p1', type: 'product', title: '14 Oz Karton Çorba Kasesi ve Kapağı 25li Paket' },
  ];
  assert.equal(chooseTarget('çorba kasesi toptan', pages).page.id, 'c1');
  assert.equal(chooseTarget('14 oz karton çorba kasesi', pages, 'product').page.id, 'p1');
  assert.equal(chooseTarget('baharat çeşitleri', pages), null);
});

test('SERP oylaması: ilk 10 sonucun çoğu kategori sayfasıysa kategori', () => {
  const urls = ['https://a.com/collections/folyo', 'https://b.com/kategori/folyo', 'https://www.trendyol.com/sr?q=folyo', 'https://c.com/products/x', 'https://d.com/blogs/news/y'];
  assert.equal(classifyUrls(urls), 'collection');
  assert.equal(classifyUrls(['https://a.com/x', 'https://b.com/y']), 'mixed');
});

test('katalogdaki ürün adı gürültü sayılmaz: pasta kutusu satan mağazada "pasta" elenmez', () => {
  assert.equal(classifyKeyword('pasta kutusu fiyat', rules, ['Pasta Kutusu 25x25']).route, 'page');
  assert.equal(classifyKeyword('pasta tarifi', rules, ['Pasta Kutusu 25x25']).route, 'drop');
});

test('genel kelime tek ürüne gitmez; ürünü ayıran ifade (marka/ölçü) varsa gider', () => {
  const pages = [
    { id: 'c', type: 'collection', handle: 'aluminyum-folyo', title: 'Alüminyum Folyo' },
    { id: 'p1', type: 'product', handle: 'n45', parent_handle: 'aluminyum-folyo', title: 'Parlak 45 Cm Alüminyum Folyo - 1000gr' },
    { id: 'p2', type: 'product', handle: 'r30', parent_handle: 'aluminyum-folyo', title: 'Rulox 30 Cm Alüminyum Folyo - 300gr' },
  ];
  assert.equal(chooseTarget('alüminyum folyo fiyatı', pages).page.id, 'c');
  assert.equal(chooseTarget('parlak alüminyum folyo', pages).page.id, 'p1');
  assert.equal(classifyKeyword('alüminyum folyo hurda fiyatı', rules).route, 'drop');
});
