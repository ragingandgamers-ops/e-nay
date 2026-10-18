// Progressive enhancement: content is visible until motion can be set up.
const preference=matchMedia('(prefers-reduced-motion: reduce)');
let observer,frame=0,photos=[];

function movePhotos(){
 frame=0;
 if(preference.matches||document.querySelector('#home-view').hidden)return;
 for(const photo of photos){
  const bounds=photo.getBoundingClientRect();
  if(bounds.bottom<0||bounds.top>innerHeight)continue;
  const position=(innerHeight/2-(bounds.top+bounds.height/2))/innerHeight;
  photo.style.setProperty('--photo-drift',`${Math.max(-10,Math.min(10,position*24)).toFixed(2)}px`);
 }
}
function schedulePhotos(){if(!frame&&!preference.matches)frame=requestAnimationFrame(movePhotos);}

export function startMotion(){
 observer?.disconnect();
 if(preference.matches||typeof window.IntersectionObserver!=='function'){
  document.documentElement.classList.remove('motion-ready');
  photos.forEach(photo=>photo.style.removeProperty('--photo-drift'));
  return;
 }
 const groups=['.hero-copy > *','.hero-art','.care-ribbon > p','.section-heading > *','.care-story figure','.story-copy > *','.anywhere-grid > div','.faq > div','.closing'];
 const targets=[];
 for(const selector of groups)document.querySelectorAll(selector).forEach((element,index)=>{
  element.dataset.reveal='';
  element.style.setProperty('--reveal-delay',`${Math.min(index,3)*65}ms`);
  targets.push(element);
 });
 observer=new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){
   entry.target.classList.add('is-revealed');
   observer.unobserve(entry.target);
  }
 },{threshold:.1,rootMargin:'0px 0px -20px 0px'});
 targets.filter(element=>!element.classList.contains('is-revealed')).forEach(element=>observer.observe(element));
 photos=[...document.querySelectorAll('.hero-photo,.care-story img')];
 document.documentElement.classList.add('motion-ready');
 schedulePhotos();
}

export function animateWorkspace(){
 const content=document.querySelector('#page-content');
 if(preference.matches||!content?.animate)return;
 content.getAnimations?.().forEach(animation=>animation.cancel());
 content.animate([{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{
  duration:360,easing:'cubic-bezier(.2,.65,.3,1)'
 });
}

window.addEventListener('scroll',schedulePhotos,{passive:true});
window.addEventListener('resize',schedulePhotos,{passive:true});
window.addEventListener('hashchange',schedulePhotos);
preference.addEventListener?.('change',()=>{
 if(preference.matches)document.querySelector('#page-content')?.getAnimations?.().forEach(animation=>animation.cancel());
 startMotion();
});
