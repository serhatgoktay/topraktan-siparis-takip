export function timestamp(value) {
  if (value instanceof Date) return value;
  return new Date(value.length === 10 ? value + 'T12:00:00+03:00' :
    /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
}
export const calendarDate = value => timestamp(value).toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
export const displayDate = value => timestamp(value).toLocaleDateString('tr-TR', {
  day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Istanbul',
});
export function matchesOrderFilters(order, filter = {}) {
  if(filter.reportType==='production'&&!['approved','preparing','ready'].includes(order.status))return false;
  if(filter.reportType==='completed'&&!['ready','delivered'].includes(order.status))return false;
  const day = filter.dateField === 'created_at' ? calendarDate(order.created_at) : filter.dateField==='completed_at' ? (order.completed_at?calendarDate(order.completed_at):'') : order.delivery;
  if(filter.dateField==='completed_at'&&!day)return false;
  const search = `${order.id} ${order.unit} ${order.items.map(i =>
    [i.name,i.category,i.subcategory,i.servings ? i.servings + ' kişilik' : ''].filter(Boolean).join(' ')).join(' ')}`;
  return (!filter.unit || order.unit === filter.unit) &&
    (!filter.status || order.status === filter.status) &&
    (!filter.from || day >= filter.from) && (!filter.to || day <= filter.to) &&
    (!filter.search || search.toLocaleLowerCase('tr').includes(filter.search.toLocaleLowerCase('tr')));
}
