// Clinic staff issue codes only after identity confirmation and reauthentication.
export async function handleRecovery(request,env,account,path,method,{bodyOf,reply,ApiError,limit,credentials,passwordHash,passwordMatches,digest,randomBytes}){
 const db=env.DB,now=Date.now(),ip=request.headers.get('CF-Connecting-IP')??'unknown';
 const invalid=()=>new ApiError(400,'The recovery code is invalid or expired. Ask clinic staff for a new code.');
 if(method!=='POST')throw new ApiError(404,'This operation is not available.');
 const input=await bodyOf(request);
 if(path==='/api/password/request'){
  const username=String(input.username??'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))throw new ApiError(400,'Use a username of 3-40 letters, numbers, periods, underscores or hyphens.');
  await limit(db,'recovery-request-ip:'+ip,10);await limit(db,'recovery-request-user:'+username,3);
  await db.prepare("INSERT INTO password_recovery_requests(account_id,requested_at,resolved_at) SELECT id,?,NULL FROM accounts WHERE username=? AND active=1 ON CONFLICT(account_id) DO UPDATE SET requested_at=excluded.requested_at,resolved_at=NULL").bind(now,username).run();
  return reply({message:'If this is an active account, the clinic can review your request. Contact clinic staff to verify your identity and receive a recovery code.'},202);
 }
 if(path==='/api/admin/password-code'){
  if(account?.role!=='staff')throw new ApiError(403,'Only authorized clinic staff can issue recovery codes.');
  if(input.identityConfirmed!==true)throw new ApiError(400,'Verify the person’s identity before issuing a recovery code.');
  if(typeof input.currentPassword!=='string'||input.currentPassword.length<12||input.currentPassword.length>128)throw new ApiError(400,'Enter your current staff password to continue.');
  await limit(db,'recovery-issue-staff:'+account.id,10);await limit(db,'recovery-issue-ip:'+ip,20);
  const issuer=await db.prepare("SELECT id,password_hash FROM accounts WHERE id=? AND active=1 AND role='staff'").bind(account.id).first();
  if(!issuer||!await passwordMatches(input.currentPassword,issuer.password_hash))throw new ApiError(403,'Your current staff password is incorrect.');
  const target=await db.prepare('SELECT id,username,display_name,role,password_hash FROM accounts WHERE id=? AND active=1').bind(typeof input.accountId==='string'?input.accountId:'').first();
  if(!target)throw new ApiError(400,'Choose an active clinic account.');
  if(target.id===account.id)throw new ApiError(409,'Ask another clinic staff member to help recover your account.');
  await limit(db,'recovery-issue-target:'+target.id,5);
  const code=randomBytes(16).toString('hex').toUpperCase(),nonce=crypto.randomUUID(),expires=Date.now()+900000;
  const result=await db.batch([
   db.prepare("INSERT INTO password_recovery_codes(account_id,code_hash,nonce,expires_at,issued_by,credential_hash,issuer_hash) SELECT a.id,?,?,?,?,a.password_hash,i.password_hash FROM accounts a JOIN accounts i ON i.id=? WHERE a.id=? AND a.active=1 AND a.id<>i.id AND i.active=1 AND i.role='staff' AND i.password_hash=? AND a.password_hash=? ON CONFLICT(account_id) DO UPDATE SET code_hash=excluded.code_hash,nonce=excluded.nonce,expires_at=excluded.expires_at,issued_by=excluded.issued_by,credential_hash=excluded.credential_hash,issuer_hash=excluded.issuer_hash").bind(digest(code),nonce,expires,issuer.id,issuer.id,target.id,issuer.password_hash,target.password_hash),
   db.prepare('UPDATE password_recovery_requests SET resolved_at=? WHERE account_id=? AND EXISTS(SELECT 1 FROM password_recovery_codes WHERE account_id=? AND nonce=?)').bind(now,target.id,target.id,nonce),
   db.prepare("INSERT INTO audit_events(id,account_id,action,created_at) SELECT ?,?,'password-code-issued',? WHERE EXISTS(SELECT 1 FROM password_recovery_codes WHERE account_id=? AND nonce=?)").bind(nonce,issuer.id,now,target.id,nonce)
  ]);
  if(result[0].meta.changes!==1)throw new ApiError(409,'Account access changed. Verify the account again before issuing a code.');
  return reply({code:code.match(/.{4}/g).join('-'),expiresAt:expires,account:{username:target.username,displayName:target.display_name,role:target.role}});
 }
 if(path==='/api/password/reset'){
  await limit(db,'recovery-reset-ip:'+ip,20);
  const {username,password}=credentials(input);await limit(db,'recovery-reset-user:'+username,8);
  if(input.confirmPassword!==password)throw new ApiError(400,'The new passwords do not match.');
  const code=String(input.code??'').replace(/[ -]/g,'').toUpperCase();if(!/^[A-F0-9]{32}$/.test(code))throw invalid();
  const hash=digest(code),token=await db.prepare("SELECT c.* FROM password_recovery_codes c JOIN accounts a ON a.id=c.account_id JOIN accounts i ON i.id=c.issued_by WHERE a.username=? AND a.active=1 AND c.code_hash=? AND c.expires_at>? AND a.password_hash=c.credential_hash AND i.active=1 AND i.role='staff' AND i.password_hash=c.issuer_hash").bind(username,hash,now).first();
  if(!token)throw invalid();
  const encoded=await passwordHash(password),time=Date.now(),event=crypto.randomUUID(),changed=" AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND password_hash=?)";
  const result=await db.batch([
   db.prepare("UPDATE accounts SET password_hash=? WHERE id=? AND active=1 AND password_hash=? AND EXISTS(SELECT 1 FROM password_recovery_codes c JOIN accounts i ON i.id=c.issued_by WHERE c.account_id=accounts.id AND c.nonce=? AND c.code_hash=? AND c.expires_at>? AND c.credential_hash=accounts.password_hash AND i.active=1 AND i.role='staff' AND i.password_hash=c.issuer_hash)").bind(encoded,token.account_id,token.credential_hash,token.nonce,hash,time),
   db.prepare('DELETE FROM sessions WHERE account_id=?'+changed).bind(token.account_id,token.account_id,encoded),
   db.prepare('DELETE FROM password_recovery_codes WHERE (account_id=? OR issued_by=?)'+changed).bind(token.account_id,token.account_id,token.account_id,encoded),
   db.prepare('DELETE FROM pairing_codes WHERE mother_id=?'+changed).bind(token.account_id,token.account_id,encoded),
   db.prepare('UPDATE password_recovery_requests SET resolved_at=? WHERE account_id=?'+changed).bind(time,token.account_id,token.account_id,encoded),
   db.prepare('DELETE FROM auth_limits WHERE bucket=?'+changed).bind(digest('login-user:'+username),token.account_id,encoded),
   db.prepare("INSERT INTO audit_events(id,account_id,action,revision,created_at) SELECT ?,?,'password-reset',?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND password_hash=?)").bind(event,token.account_id,token.nonce,time,token.account_id,encoded)
  ]);
  if(result[0].meta.changes!==1)throw invalid();
  return reply({reset:true,message:'Password updated. Sign in with your new password. Your clinic records are unchanged.'});
 }
 throw new ApiError(404,'This operation is not available.');
}
