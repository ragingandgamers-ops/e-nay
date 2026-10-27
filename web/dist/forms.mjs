import {label,setText} from './language.mjs';
// Derive markers from live constraints so conditional fields cannot keep stale labels.
export function updateFieldRequirements(root){
 for(const control of root.querySelectorAll('input[id],select[id],textarea[id]')){
  const target=[...root.querySelectorAll('label[for]')].find(l=>l.htmlFor===control.id);if(!target)continue;
  const editable=!control.disabled&&!control.readOnly&&!control.closest('[hidden]'),required=editable&&control.required,state=required?'required':editable?'optional':'none';
  if(control.getAttribute('aria-required')!==String(required))control.setAttribute('aria-required',String(required));
  const old=target.querySelector('[data-field-requirement]');if(old?.dataset.state===state)continue;old?.remove();
  const marker=document.createElement('span');marker.dataset.fieldRequirement='';marker.dataset.state=state;marker.className=required?'field-required':'field-optional';
  marker.innerHTML=required?'<span aria-hidden="true"> *</span><span class="sr-only"> '+label('required')+'</span>':editable?' '+label('(optional)'):'';target.append(marker);
 }
}
export function updateMaternalRequirements(root){
 for(const status of root.querySelectorAll('[name=pregnancyStatus]')){const form=status.closest('form')??root,due=form.querySelector('[name=edd]');if(!due)continue;
  const notPregnant=status.value==='Not pregnant';due.disabled=status.disabled||notPregnant;due.required=status.value==='Pregnant'&&!status.disabled;due.setAttribute('aria-disabled',String(due.disabled));
  let hint=form.querySelector('#'+due.id+'-not-needed');if(!hint){hint=document.createElement('span');hint.id=due.id+'-not-needed';hint.className='hint';setText(hint,'Not needed when not pregnant.');due.after(hint);}
  hint.hidden=!notPregnant||status.disabled;
 }
 updateFieldRequirements(root);
}
