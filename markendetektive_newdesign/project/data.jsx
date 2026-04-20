// data.jsx — shared mock data for MarkenDetektive prototype

const MARKETS = {
  lidl:     { name: 'Lidl',      tint: '#0050aa', short: 'L' },
  aldi:     { name: 'Aldi',      tint: '#00549f', short: 'A' },
  rewe:     { name: 'Rewe',      tint: '#cc071e', short: 'R' },
  kaufland: { name: 'Kaufland',  tint: '#e10915', short: 'K' },
  penny:    { name: 'Penny',     tint: '#cc0000', short: 'P' },
  edeka:    { name: 'Edeka',     tint: '#004c9f', short: 'E' },
  netto:    { name: 'Netto',     tint: '#ffe500', short: 'N' },
  dm:       { name: 'dm',        tint: '#004d9f', short: 'dm' },
};

// Image bg recipes — soft gradient backgrounds per category, paired with emoji
const IMG = {
  dairy:    ['#bfd8d4', '#78a8a3'],
  chocolate:['#e8dcc8', '#bfa580'],
  drink:    ['#8fbcd4', '#4a7a94'],
  muesli:   ['#e6d8b8', '#c9b57c'],
  candy:    ['#f4c987', '#e09b3d'],
  pasta:    ['#f0ddb0', '#caa668'],
  cosmetic: ['#d9e9f7', '#a9c8e6'],
  coffee:   ['#d4bfa8', '#8a6848'],
  cheese:   ['#ecd480', '#c09040'],
};

const PRODUCTS = [
  {
    id: 'mueller-milchreis',
    brand: 'Müller',
    markeColor: '#d6001c',
    maker: 'Unternehmensgruppe Theo Müller',
    name: 'Milchreis Klassik',
    size: '200 g',
    category: 'Molkerei',
    emoji: '🥛',
    tint: IMG.dairy,
    brandPrice: 1.99,
    tags: ['🥛 Vollmilch', '🍚 Rundkornreis'],
    noNames: [
      { id: 'milbona-mr', market: 'lidl',     brand: 'Milbona',     name: 'Milchreis',            size: '200 g', price: 0.49, stufe: 5, maker: 'Müller Group', unit: '200g (2,45€/kg)' },
      { id: 'desira-mr',  market: 'aldi',     brand: 'Desira',      name: 'Milchreis Vanille',    size: '200 g', price: 0.55, stufe: 5, maker: 'Müller Group', unit: '200g (2,75€/kg)' },
      { id: 'ja-mr',      market: 'rewe',     brand: 'Ja!',         name: 'Milchreis',            size: '200 g', price: 0.59, stufe: 4, maker: 'Müller Group', unit: '200g (2,95€/kg)' },
      { id: 'kc-mr',      market: 'kaufland', brand: 'K-Classic',   name: 'Milchreis',            size: '200 g', price: 0.65, stufe: 4, maker: 'Müller Group', unit: '200g (3,25€/kg)' },
    ],
  },
  {
    id: 'milka-alpenmilch',
    brand: 'Milka',
    markeColor: '#8a4d9e',
    maker: 'Mondelez International',
    name: 'Alpenmilch Schokolade',
    size: '100 g',
    category: 'Schokolade',
    emoji: '🍫',
    tint: IMG.chocolate,
    brandPrice: 1.49,
    tags: ['🍫 Schokolade', '🥛 Vollmilch'],
    noNames: [
      { id: 'fc-alpen',   market: 'lidl',     brand: 'Fin Carré',   name: 'Alpenvoll Schokolade', size: '100 g', price: 0.89, stufe: 5, maker: 'Alpia GmbH', unit: '100g (8,90€/kg)' },
      { id: 'mi-alpen',   market: 'aldi',     brand: 'Moser Roth',  name: 'Edel Vollmilch',       size: '100 g', price: 0.99, stufe: 5, maker: 'Alpia GmbH', unit: '100g (9,90€/kg)' },
      { id: 'csk-vm',     market: 'kaufland', brand: 'K-Classic',   name: 'Vollmilch Schokolade', size: '100 g', price: 0.95, stufe: 4, maker: 'Alpia GmbH', unit: '100g (9,50€/kg)' },
    ],
  },
  {
    id: 'nutella-400',
    brand: 'Nutella',
    markeColor: '#3b2314',
    maker: 'Ferrero',
    name: 'Nuss-Nougat-Creme',
    size: '400 g',
    category: 'Brotaufstrich',
    emoji: '🥜',
    tint: IMG.chocolate,
    brandPrice: 3.49,
    tags: ['🌰 Haselnuss', '🍫 Kakao'],
    noNames: [
      { id: 'nk-400',     market: 'rewe',     brand: 'Ja!',         name: 'Nuss-Nougat Creme',    size: '400 g', price: 1.49, stufe: 4, maker: 'Goldeck Süßwaren', unit: '400g (3,72€/kg)' },
      { id: 'nk-lidl',    market: 'lidl',     brand: 'Nusskati',    name: 'Haselnuss Creme',      size: '400 g', price: 1.99, stufe: 4, maker: 'Goldeck Süßwaren', unit: '400g (4,72€/kg)' },
      { id: 'ccr-nuss',   market: 'aldi',     brand: 'Nussriegel',  name: 'Vollnuss Creme',       size: '400 g', price: 2.09, stufe: 3, maker: 'Goldeck Süßwaren', unit: '400g (5,22€/kg)' },
    ],
  },
  {
    id: 'cocacola-15',
    brand: 'Coca-Cola',
    markeColor: '#e51b24',
    maker: 'Coca-Cola European Partners',
    name: 'Classic',
    size: '1,5 L',
    category: 'Getränke',
    emoji: '🥤',
    tint: IMG.drink,
    brandPrice: 1.89,
    tags: ['🥤 Cola', '⚡ Koffein'],
    noNames: [
      { id: 'fw-15',      market: 'lidl',     brand: 'FreeWay',     name: 'Cola Classic',         size: '1,5 L', price: 0.55, stufe: 5, maker: 'Refresco DE', unit: '1,5L (0,37€/L)' },
      { id: 'river-15',   market: 'aldi',     brand: 'River',       name: 'Cola',                 size: '1,5 L', price: 0.59, stufe: 5, maker: 'Refresco DE', unit: '1,5L (0,39€/L)' },
      { id: 'ja-cola',    market: 'rewe',     brand: 'Ja!',         name: 'Cola',                 size: '1,5 L', price: 0.65, stufe: 4, maker: 'Refresco DE', unit: '1,5L (0,43€/L)' },
      { id: 'penny-cola', market: 'penny',    brand: 'Penny',       name: 'Cola',                 size: '1,5 L', price: 0.49, stufe: 3, maker: 'unbestätigt', unit: '1,5L (0,33€/L)' },
    ],
  },
  {
    id: 'coffee-lav',
    brand: 'Lavazza',
    markeColor: '#003366',
    maker: 'Luigi Lavazza S.p.A.',
    name: 'Crema e Aroma Ganze Bohne',
    size: '1 kg',
    category: 'Kaffee',
    emoji: '☕',
    tint: IMG.coffee,
    brandPrice: 13.99,
    tags: ['☕ Espresso'],
    noNames: [
      { id: 'moreno-cc',  market: 'aldi',     brand: 'Moreno',      name: 'Caffè Crema Ganze Bohne', size: '1 kg', price: 8.99, stufe: 3, maker: 'Tchibo GmbH', unit: '1kg (8,99€/kg)' },
      { id: 'bella-cc',   market: 'lidl',     brand: 'Bellarom',    name: 'Caffè Crema',          size: '1 kg', price: 9.49, stufe: 4, maker: 'Melitta', unit: '1kg (9,49€/kg)' },
    ],
  },
  {
    id: 'frischkase',
    brand: 'Philadelphia',
    markeColor: '#006abf',
    maker: 'Mondelez International',
    name: 'Frischkäse Natur',
    size: '200 g',
    category: 'Käse',
    emoji: '🧀',
    tint: IMG.cheese,
    brandPrice: 2.19,
    tags: ['🧀 Frischkäse'],
    noNames: [
      { id: 'frischer-lidl', market: 'lidl',  brand: 'Frischer',    name: 'Cremiger Frischkäse',  size: '200 g', price: 0.79, stufe: 4, maker: 'Hochwald Foods', unit: '200g (3,95€/kg)' },
      { id: 'hoch-aldi',     market: 'aldi',  brand: 'Hofmark',     name: 'Frischkäse',           size: '200 g', price: 0.85, stufe: 4, maker: 'Hochwald Foods', unit: '200g (4,25€/kg)' },
    ],
  },
  {
    id: 'hafer-drink',
    brand: 'Alpro',
    markeColor: '#6abf3f',
    maker: 'Danone S.A.',
    name: 'Bio Haferdrink',
    size: '1 L',
    category: 'Molkerei',
    emoji: '🥛',
    tint: IMG.dairy,
    brandPrice: 2.29,
    tags: ['🌾 Hafer', '🌱 Bio'],
    noNames: [
      { id: 'milbona-haf', market: 'lidl',    brand: 'Milbona',     name: 'Bio Haferdrink',       size: '1 L',  price: 0.95, stufe: 5, maker: 'Berief Food', unit: '1L (0,95€/L)' },
    ],
  },

  // ── Orphan NoName products (Stufe 1 & 2) — no linked brand product ──
  {
    id: 'gutbio-apfelmus',
    orphan: true,
    brand: 'GUT BIO',
    name: 'Apfelmus ungesüßt',
    category: 'Konserven',
    emoji: '🍎',
    tint: ['#f4d5b5', '#d89a5c'],
    brandPrice: 1.19,
    size: '700 g',
    unit: '700g (1,70€/kg)',
    stufe: 2,
    market: 'aldi',
    maker: 'Obsthof Nord GmbH',
    tags: ['🍎 Bio', '🌱 Vegan'],
    noNames: [],
  },
  {
    id: 'mibell-butterkeks',
    orphan: true,
    brand: 'Mibell',
    name: 'Butterkeks Klassik',
    category: 'Süßwaren',
    emoji: '🍪',
    tint: ['#f0ddb0', '#caa668'],
    brandPrice: 0.69,
    size: '200 g',
    unit: '200g (3,45€/kg)',
    stufe: 1,
    market: 'lidl',
    maker: 'Griesson - de Beukelaer',
    tags: ['🍪 Keks', '🧈 Butter'],
    noNames: [],
  },
  {
    id: 'ja-sonnenblumenol',
    orphan: true,
    brand: 'Ja!',
    name: 'Sonnenblumenöl raffiniert',
    category: 'Grundnahrung',
    emoji: '🌻',
    tint: ['#fbe9b0', '#e0b44a'],
    brandPrice: 2.29,
    size: '1 L',
    unit: '1L (2,29€/L)',
    stufe: 2,
    market: 'rewe',
    maker: 'Walter Rau Lebensmittelwerke',
    tags: ['🌻 Pflanzenöl'],
    noNames: [],
  },
];

// Helpers
const bestNoName  = (p) => p.noNames?.length ? [...p.noNames].sort((a,b) => b.stufe - a.stufe || a.price - b.price)[0] : null;
const savings     = (p, nn) => nn ? +(p.brandPrice - nn.price).toFixed(2) : 0;
const savingsPct  = (p, nn) => nn ? Math.round(((p.brandPrice - nn.price) / p.brandPrice) * 100) : 0;

// For orphan NoName products — synthesize a NoName-shaped object from the product itself
const asOwnNN = (p) => ({
  id: p.id, market: p.market, brand: p.brand, name: p.name,
  size: p.size, price: p.brandPrice, stufe: p.stufe, maker: p.maker, unit: p.unit,
});

// Placeholder image: gradient + emoji as a background element. Returns a React node.
function ProductImg({ product, size = 160, rounded = 16, children, style = {} }) {
  const [c1, c2] = product.tint;
  return (
    <div style={{
      width: '100%', height: size, borderRadius: rounded,
      background: `linear-gradient(135deg,${c1},${c2})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden', ...style,
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,.4), transparent 55%)',
      }}/>
      <span style={{ fontSize: size * 0.5, position: 'relative', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.15))' }}>{product.emoji}</span>
      {children}
    </div>
  );
}

Object.assign(window, { MARKETS, PRODUCTS, bestNoName, savings, savingsPct, ProductImg, asOwnNN });
