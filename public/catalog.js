export const CATEGORIES = [
  'Çikolatalar', 'Pastalar', 'Tatlı kurabiyeler',
  'Sütlü tatlılar', 'Şerbetli tatlılar', 'Tuzlu kurabiyeler',
];
export const CAKE_SUBCATEGORIES = [
  'Figürlü adet pastalar', 'Bebek ve çocuk pastaları', 'Kutlama pastaları',
  'Vitrin pastaları', 'Adet pastalar', 'Cheesecake',
];
export const SERVING_SUBCATEGORIES = [
  'Bebek ve çocuk pastaları', 'Kutlama pastaları', 'Vitrin pastaları', 'Cheesecake',
];
export const needsServings = (category, subcategory) =>
  category === 'Pastalar' && SERVING_SUBCATEGORIES.includes(subcategory);
export const categoryPath = item =>
  [item.category, item.subcategory].filter(Boolean).join(' / ') || 'Kategorisiz';

export function summarizeProducts(orders) {
  const grouped = new Map();
  for (const order of orders) for (const item of order.items) {
    const key = JSON.stringify([
      item.product_id ?? null, item.name, item.measure,
      item.category ?? null, item.subcategory ?? null, item.servings ?? null,
    ]);
    if (!grouped.has(key)) grouped.set(key, { ...item, quantity: 0 });
    grouped.get(key).quantity += Number(item.quantity);
  }
  return [...grouped.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'tr') || (a.servings || 0) - (b.servings || 0));
}
