export const password='Fictional-test-password-2026!';
export async function signIn(page,username='test.staff'){
 await page.locator('#account-username').fill(username);await page.locator('#account-password').fill(password);await page.locator('#auth-submit').click();await page.locator('#workspace-view').waitFor({state:'visible'});
}
export async function privateCopy(page,username='test.staff'){return page.evaluate(async({password,username})=>{
 const connection=await new Promise((resolve,reject)=>{const r=indexedDB.open('enay-private-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const row=await new Promise((resolve,reject)=>{const r=connection.transaction('copies').objectStore('copies').get(username);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt:row.salt},material,{name:'AES-GCM',length:256},false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:new TextEncoder().encode(JSON.stringify([row.account.id,row.account.username,row.account.role]))},key,row.cipher);connection.close();return JSON.parse(new TextDecoder().decode(plain)).data;
},{password,username});}
export async function resetClinic(base){const fixture=await fetch(base+'__test/reset-auth',{method:'POST',headers:{Origin:new URL(base).origin}});if(fixture.status!==204)throw new Error('Browser fixtures require the disposable --test server; refusing to reset other clinic data.');const login=await fetch(base+'api/login',{method:'POST',headers:{Origin:new URL(base).origin,'Content-Type':'application/json'},body:JSON.stringify({username:'test.staff',password})});const {proof}=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];const headers={Origin:new URL(base).origin,'Content-Type':'application/json','X-Enay-Access':proof,Cookie:cookie};const current=await (await fetch(base+'api/workspace',{headers})).json();await fetch(base+'api/workspace',{method:'PUT',headers,body:JSON.stringify({epoch:current.epoch,baseRevision:current.revision,operationId:crypto.randomUUID(),data:Object.fromEntries(['mothers','children','visits','vaccines','growth','inventory','guides'].map(t=>[t,[]]))})});}

export async function profileAction(page,id){await page.locator('#open-profile').click();await page.locator('#'+id).click();if(id==='sync-records')await page.waitForFunction(()=>!document.querySelector('#sync-records').disabled);if(await page.locator('#profile-dialog').isVisible())await page.locator('#close-profile').click();}
export async function waitOffline(page,text='Offline ready · App downloaded'){await page.waitForFunction(value=>document.querySelector('#offline-status')?.textContent===value,text,{timeout:20000});}
