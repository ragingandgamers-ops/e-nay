/* Runs before styles so the saved/system appearance is applied before paint. */
(()=>{
 const key='enay.theme.v1',root=document.documentElement,system=window.matchMedia('(prefers-color-scheme: dark)');
 let preference='system';try{const saved=localStorage.getItem(key);if(['light','dark','system'].includes(saved))preference=saved;}catch{}
 function apply(){
  root.dataset.theme=preference==='system'?(system.matches?'dark':'light'):preference;
  root.dataset.themePreference=preference;
  root.style.colorScheme=root.dataset.theme;
  for(const select of document.querySelectorAll('[data-theme-picker]'))select.value=preference;
 }
 apply();document.addEventListener('DOMContentLoaded',apply);
 system.addEventListener('change',()=>{if(preference==='system')apply();});
 document.addEventListener('change',event=>{if(!event.target.matches('[data-theme-picker]'))return;const next=event.target.value;if(!['light','dark','system'].includes(next))return;preference=next;try{localStorage.setItem(key,next);}catch{}apply();});
 window.addEventListener('storage',event=>{if(event.key!==key)return;preference=['light','dark'].includes(event.newValue)?event.newValue:'system';apply();});
})();
