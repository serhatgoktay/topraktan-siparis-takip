import ExcelJS from 'exceljs';
import {calendarDate, matchesOrderFilters} from './public/dates.js';
import {summarizeProducts} from './public/catalog.js';

export const STATUS_LABELS={pending:'Onay bekliyor',approved:'Onaylandı',preparing:'Hazırlanıyor',ready:'Hazır',delivered:'Teslim edildi',rejected:'Reddedildi'};
const units=['Bahçe','Küçükpark','Evka3'];
export const MAX_EXCEL_LINES=20000;
export function reportFilters(params) {
  const result=Object.fromEntries(['unit','status','from','to','search','dateField'].map(k=>[k,params.get(k)||'']));
  if(result.unit&&!units.includes(result.unit)||result.status&&!STATUS_LABELS[result.status]||result.dateField&&!['created_at','delivery'].includes(result.dateField))throw Object.assign(Error('Rapor filtreleri geçersiz.'),{status:400});
  for(const key of ['from','to'])if(result[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(result[key])||!Number.isFinite(Date.parse(result[key]))||new Date(result[key]).toISOString().slice(0,10)!==result[key]))throw Object.assign(Error('Rapor tarih aralığı geçersiz.'),{status:400});
  if(result.search.length>200)throw Object.assign(Error('Arama en fazla 200 karakter olabilir.'),{status:400});
  result.dateField ||= 'delivery';return result;
}
function sheet(book,name,columns) {
  const ws=book.addWorksheet(name,{views:[{state:'frozen',ySplit:1}],properties:{tabColor:{argb:'FF294D3E'}}});
  ws.columns=columns.map(([header,key,width])=>({header,key,width}));
  ws.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};
  ws.getRow(1).height=30;
  ws.getRow(1).eachCell(cell=>{cell.font={name:'Calibri',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF294D3E'}};cell.alignment={vertical:'middle',wrapText:true};});
  ws.properties.defaultRowHeight=20;
  ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
  return ws;
}
const excelDate=value=>new Date(calendarDate(value)+'T00:00:00.000Z');
export async function createExcelReport(visibleOrders, filter={}, {userName='',branchUnits=units}={}) {
  const orders=visibleOrders.filter(o=>matchesOrderFilters(o,filter));
  if(orders.reduce((sum,o)=>sum+o.items.length,0)>MAX_EXCEL_LINES)throw Object.assign(Error('Excel raporu çok büyük. Daha dar bir tarih aralığı seçin.'),{status:413});
  const book=new ExcelJS.Workbook();book.creator='Topraktan';book.created=new Date();book.modified=book.created;book.views=[{activeTab:0}];
  const detail=sheet(book,'Siparişler',[
    ['Sipariş no','orderId',14],['Şube','unit',18],['Sipariş tarihi','created',18],['Teslim tarihi','delivery',18],
    ['Durum','status',20],['Ürün','product',32],['Kategori','category',24],['Alt kategori','subcategory',30],
    ['Kişilik','servings',13],['Miktar','quantity',14],['Birim','measure',12],['Sipariş veren','creator',24],['Not','note',45],
  ]);
  for(const o of orders)for(const i of o.items)detail.addRow({orderId:Number(o.id),unit:o.unit,created:excelDate(o.created_at),delivery:excelDate(o.delivery),status:STATUS_LABELS[o.status],product:i.name,category:i.category||'',subcategory:i.subcategory||'',servings:i.servings||null,quantity:Number(i.quantity),measure:i.measure,creator:o.creator,note:o.note||''});
  detail.getColumn('created').numFmt='dd.mm.yyyy';detail.getColumn('delivery').numFmt='dd.mm.yyyy';detail.getColumn('quantity').numFmt='0.###';detail.getColumn('servings').numFmt='0" kişilik"';detail.getColumn('note').alignment={wrapText:true,vertical:'top'};
  const totals=sheet(book,'Ürün toplamları',[
    ['Ürün','name',34],['Kategori','category',25],['Alt kategori','subcategory',30],['Kişilik','servings',13],['Toplam miktar','quantity',18],['Birim','measure',12],
  ]);
  for(const item of summarizeProducts(orders))totals.addRow({name:item.name,category:item.category||'',subcategory:item.subcategory||'',servings:item.servings||null,quantity:item.quantity,measure:item.measure});
  totals.getColumn('quantity').numFmt='0.###';totals.getColumn('servings').numFmt='0" kişilik"';
  const summary=sheet(book,'Şube özeti',[
    ['Şube','unit',18],['Sipariş sayısı','orders',17],...Object.entries(STATUS_LABELS).map(([key,label])=>[label,key,18]),['Toplam adet','adet',17],['Toplam kg','kg',17],['Toplam tepsi','tepsi',17],
  ]);
  for(const unit of branchUnits){const rows=orders.filter(o=>o.unit===unit),row={unit,orders:rows.length,adet:0,kg:0,tepsi:0,...Object.fromEntries(Object.keys(STATUS_LABELS).map(s=>[s,0]))};for(const o of rows){row[o.status]++;for(const i of o.items)row[i.measure]+=Number(i.quantity);}summary.addRow(row);}
  summary.getColumn('kg').numFmt='0.###';
  const info=sheet(book,'Rapor bilgisi',[['Alan','field',28],['Değer','value',90]]);
  const records=[['Oluşturma zamanı',book.created.toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})],['Raporu indiren',userName],['Tarih alanı',filter.dateField==='created_at'?'Sipariş tarihi':'Teslim tarihi'],['Başlangıç',filter.from||'Sınır yok'],['Bitiş',filter.to||'Sınır yok'],['Şube filtresi',filter.unit||'Yetkili olduğunuz şubeler'],['Durum',STATUS_LABELS[filter.status]||'Tüm durumlar'],['Arama',filter.search||'Yok'],['Sipariş sayısı',orders.length],['Kalem sayısı',orders.reduce((n,o)=>n+o.items.length,0)],['Kapsam','Yalnızca hesabınızın görebildiği siparişler raporlanır.'],['Kişilik','Kişi sayısı bir pastanın boyutudur. Farklı kişilikler ürün toplamlarında ayrı satırlardadır.'],['Durum kapsamı','Durum filtresi yoksa reddedilenler dahil tüm durumlar raporlanır.']];
  for(const [field,value] of records)info.addRow({field,value});info.getColumn('value').alignment={wrapText:true,vertical:'top'};
  return Buffer.from(await book.xlsx.writeBuffer());
}
