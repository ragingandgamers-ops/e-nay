// Browsing helpers never modify the source records or their identifiers.
const collator=new Intl.Collator('en-PH',{sensitivity:'base',numeric:true});
export const searchText=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().trim();
export function orderItems(items,mode='name',name=item=>item.name??'',date=item=>item.date??''){
 return [...items].sort((a,b)=>{
  const compare=mode==='id'?collator.compare(a.id,b.id):mode==='date-newest'||mode==='date-oldest'?
   (!date(a)&&!date(b)?0:!date(a)?1:!date(b)?-1:(mode==='date-newest'?-1:1)*collator.compare(date(a),date(b))):
   (mode==='name-desc'?-1:1)*collator.compare(name(a),name(b));
  return compare||collator.compare(a.id,b.id);
 });
}
export function pageItems(items,page=1,size=10){
 size=[10,20,50].includes(Number(size))?Number(size):10;
 const pages=Math.max(1,Math.ceil(items.length/size));
 page=Math.min(pages,Math.max(1,Math.floor(Number(page)||1)));
 const offset=(page-1)*size;
 return {items:items.slice(offset,offset+size),page,pages,total:items.length,start:items.length?offset+1:0,end:Math.min(offset+size,items.length)};
}
