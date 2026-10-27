import {filipino} from './filipino.mjs';

const STORAGE='enay.language.v1',PREFIX='enay-ui:';
let language='en';
try{if(localStorage.getItem(STORAGE)==='fil')language='fil';}catch{}
export const currentLanguage=()=>language;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyOf=text=>String(text).trim().replace(/\s+/g,' ');
const encode=value=>encodeURIComponent(JSON.stringify(value)).replace(/-/g,'%2D');
const patterns=[
 [/^Line (\d+): (.+)$/, (number,message)=>`Hanay ${number}: ${t(message)}`],
 [/^Use (\d+) characters or fewer\.$/,n=>`Gumamit ng hanggang ${n} character lamang.`],
 [/^Enter (a whole number|a number) from ([\d.]+) to ([\d.]+)\.$/,(kind,min,max)=>`Maglagay ng ${kind==='a whole number'?'buong numero':'numero'} mula ${min} hanggang ${max}.`],
 [/^Use ([MC]) followed by exactly three digits, for example ([MC]001)\.$/,(prefix,example)=>`Gamitin ang ${prefix} na sinusundan ng eksaktong tatlong numero, gaya ng ${example}.`],
 [/^Choose (.+)\.$/,choices=>`Pumili: ${choices.split(' or ').map(x=>filipino[x]??x).join(' o ')}.`],
 [/^The backup is missing (mothers|children|visits|vaccines|growth|inventory) records\.$/,type=>`Kulang ang backup ng mga rekord: ${filipino[type]??type}.`]
];
export function t(key,params={}){
 const source=keyOf(key);let value=language==='fil'?filipino[source]:source;
 if(value===undefined){value=source;for(const [pattern,translate]of patterns){const match=source.match(pattern);if(match){value=translate(...match.slice(1));break;}}}
 return value.replace(/\{(\w+)\}/g,(all,name)=>{
  if(!Object.hasOwn(params,name))return all;
  const item=params[name];
  if(item&&typeof item==='object'&&typeof item.ui==='string')return t(item.ui);
  if(item&&typeof item==='object'&&typeof item.date==='string')return new Date(item.date+'T00:00:00').toLocaleDateString(language==='fil'?'fil-PH':'en-PH',item.format==='long'?{weekday:'long',month:'long',day:'numeric',year:'numeric'}:{month:'short',day:'numeric',year:'numeric'});
  return String(item);
 });
}
export function label(key,params={}){return `<!--${PREFIX}${encode({key:keyOf(key),params})}-->${esc(t(key,params))}<!--enay-ui-end-->`;}
export function setText(element,key,params={}){element.dataset.uiText=JSON.stringify({key:keyOf(key),params});element.textContent=t(key,params);}
const decoder=document.createElement('textarea');
function decode(text){decoder.innerHTML=text;return decoder.value;}
// Only literal UI fragments are annotated. Interpolations are replaced AFTER
// annotation, so patient names, notes, usernames and other record values cannot
// become translation keys, even when they exactly match a UI word.
export function markup(source,token=''){
 return source.split(/(<[^>]*>)/g).map(part=>{
  if(part.startsWith('<')){
   if(/^<\//.test(part)||part.startsWith('<!--'))return part;
   const attributes={};
   let tag=part.replace(/\b(aria-label|title|placeholder|alt|data-label)="([^"]*)"/g,(whole,name,value)=>{
    if(!value||(token&&value.includes(token)))return whole;
    const key=decode(value);attributes[name]=key;return `${name}="${esc(t(key))}"`;
   });
   if(Object.keys(attributes).length)tag=tag.replace(/\/?>(?=$)/,end=>` data-ui-attrs="${esc(JSON.stringify(attributes))}"${end}`);
   return tag;
  }
  if(!part.trim()||(token&&part.includes(token)))return part;
  const leading=part.match(/^\s*/)[0],trailing=part.match(/\s*$/)[0];return leading+label(decode(part.trim()))+trailing;
 }).join('');
}
let sequence=0;
export function ui(parts,...values){
 const token=`enay_value_${sequence++}_`;
 let source=parts[0];for(let i=0;i<values.length;i++)source+=token+i+'_end'+parts[i+1];
 const annotated=markup(source,token);
 return annotated.replace(new RegExp(token+'(\\d+)_end','g'),(_,i)=>String(values[Number(i)]??''));
}
export function applyTranslations(root=document){
 const walk=document.createTreeWalker(root,NodeFilter.SHOW_COMMENT);
 while(walk.nextNode()){
  const node=walk.currentNode;if(!node.data.startsWith(PREFIX)||node.nextSibling?.nodeType!==Node.TEXT_NODE)continue;
  const {key,params,before='',after=''}=JSON.parse(decodeURIComponent(node.data.slice(PREFIX.length)));node.nextSibling.nodeValue=before+t(key,params)+after;
 }
 for(const element of root.querySelectorAll('[data-ui-text]')){
  // A loading message may have been replaced by an interactive import preview.
  // Retire that old binding instead of replacing the new controls with text.
  if(element.childElementCount){delete element.dataset.uiText;continue;}
  const {key,params}=JSON.parse(element.dataset.uiText);element.textContent=t(key,params);
 }
 for(const element of root.querySelectorAll('[data-ui-attrs]'))for(const [name,source]of Object.entries(JSON.parse(element.dataset.uiAttrs)))element.setAttribute(name,typeof source==='string'?t(source):t(source.key,source.params));
 document.documentElement.lang=language==='fil'?'fil':'en';
 for(const button of document.querySelectorAll('[data-language]'))button.setAttribute('aria-pressed',String(button.dataset.language===language));
}
export function initLanguage(){
 // Capture the original static document once, before any account data is shown.
 const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),nodes=[];
 while(walk.nextNode()){const node=walk.currentNode;if(node.nodeValue.trim()&&!node.parentElement.closest('script,style,noscript,[data-no-translate]'))nodes.push(node);}
 for(const node of nodes){const leading=node.nodeValue.match(/^\s*/)[0],trailing=node.nodeValue.match(/\s*$/)[0],key=keyOf(node.nodeValue);node.before(document.createComment(PREFIX+encode({key,params:{},before:leading,after:trailing})));node.after(document.createComment('enay-ui-end'));node.nodeValue=leading+t(key)+trailing;}
 for(const element of document.body.querySelectorAll('[aria-label],[title],[placeholder],[alt],[data-label]')){
  const attributes={};for(const name of ['aria-label','title','placeholder','alt','data-label'])if(element.getAttribute(name))attributes[name]=element.getAttribute(name);
  element.dataset.uiAttrs=JSON.stringify(attributes);
 }
 applyTranslations();
 document.addEventListener('click',event=>{const button=event.target.closest('[data-language]');if(button)changeLanguage(button.dataset.language);});
 window.addEventListener('storage',event=>{if(event.key===STORAGE)changeLanguage(event.newValue==='fil'?'fil':'en',false);});
}
function changeLanguage(next,persist=true){
 if(!['en','fil'].includes(next)||next===language)return;
 language=next;if(persist)try{localStorage.setItem(STORAGE,language);}catch{}
 applyTranslations();document.dispatchEvent(new CustomEvent('enay-language-change'));
 const feedback=document.querySelector('#language-feedback');if(feedback)feedback.textContent=t(language==='fil'?'Filipino selected.':'English selected.');
}
