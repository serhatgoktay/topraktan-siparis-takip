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
    if (!grouped.has(key)) grouped.set(key, { ...item, quantity: 0, ordered_quantity: 0, cancelled_quantity: 0 });
    const total=grouped.get(key);
    total.ordered_quantity+=Number(item.quantity);
    total.cancelled_quantity+=Number(item.cancelled_quantity||0);
    total.quantity+=Math.max(0,Number(item.quantity)-Number(item.cancelled_quantity||0));
  }
  return [...grouped.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'tr') || (a.servings || 0) - (b.servings || 0));
}
