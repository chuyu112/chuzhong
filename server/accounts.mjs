import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const duration = 7 * 24 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const publicUser = u => ({ id:u.id, phone:u.phone, role:u.role, mustChangePassword:!!u.must_change_password, createdAt:u.created_at });
export function normalizePhone(value) {
 const phone=String(value||'').trim().replace(/[\s-]/g,'').replace(/^\+86/,'');
 if(!/^1[3-9]\d{9}$/.test(phone))throw fail('请输入有效的 11 位中国大陆手机号');
 return phone;
}
export function validatePassword(value) {
 if(typeof value!=='string'||value.length<8||value.length>128||!/[A-Z]/.test(value)||!/[a-z]/.test(value))throw fail('密码需为 8—128 位，同时包含大写和小写字母');
}
async function hashPassword(password) {
 const salt=randomBytes(16).toString('hex');
 const hash=await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return `scrypt:${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password,stored) {
 const [,salt='0'.repeat(32),encoded='0'.repeat(128)]=(stored||'').split(':');
 const hash=await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const expected=Buffer.from(encoded,'hex');
 return hash.length===expected.length&&timingSafeEqual(hash,expected);
}
export function createAccountAuth(db,{secure=false}={}) {
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,phone TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',must_change_password INTEGER NOT NULL DEFAULT 0,password_version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,password_version INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
 CREATE TABLE IF NOT EXISTS account_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,target_id TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL);`);
 const byId=id=>db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
 const cookieHeader=(token,age=duration/1000)=>`zhixu_auth=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
 const readToken=req=>String(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('zhixu_auth='))?.slice(11)||'';
 const issueSession=user=>{
  db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(Date.now());
  const token=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO auth_sessions(token_hash,user_id,password_version,expires_at) VALUES(?,?,?,?)').run(digest(token),user.id,user.password_version,Date.now()+duration);
  return {user:publicUser(user),cookie:cookieHeader(token)};
 };
 const setPassword=(user,passwordHash,temporary,actor)=>{
  db.exec('BEGIN IMMEDIATE');
  try{
   const changed=db.prepare('UPDATE accounts SET password_hash=?,must_change_password=?,password_version=password_version+1 WHERE id=? AND password_version=?').run(passwordHash,temporary?1:0,user.id,user.password_version);
   if(changed.changes!==1)throw fail('密码刚刚发生变更，请重新登录后再试',409);
   db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(user.id);
   db.prepare('INSERT INTO account_audit VALUES(?,?,?,?,?)').run(randomUUID(),actor,user.id,temporary?'admin_password_reset':'password_changed',new Date().toISOString());
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 };
 return {
  async ensureAdmin(phone,password){
   if(!phone)return;
   phone=normalizePhone(phone);
   const existing=db.prepare('SELECT * FROM accounts WHERE phone=?').get(phone);
   if(existing){if(existing.role!=='admin')throw new Error('管理员手机号已存在，请由服务器管理员核验');return publicUser(existing);}
   validatePassword(password);
   const hash=await hashPassword(password);
   const id=randomUUID();db.prepare('INSERT INTO accounts(id,phone,password_hash,role,must_change_password,created_at) VALUES(?,?,?,?,?,?)').run(id,phone,hash,'admin',1,new Date().toISOString());return publicUser(byId(id));
  },
  user(req){
   const token=readToken(req);if(!/^[a-f0-9]{64}$/.test(token))return null;
   const u=db.prepare('SELECT a.* FROM accounts a JOIN auth_sessions s ON s.user_id=a.id WHERE s.token_hash=? AND s.expires_at>? AND s.password_version=a.password_version').get(digest(token),Date.now());
   return u?publicUser(u):null;
  },
  async register(input){
   const phone=normalizePhone(input.phone);validatePassword(input.password);
   if(db.prepare('SELECT id FROM accounts WHERE phone=?').get(phone))throw fail('该手机号已注册，请直接登录',409);
   const hash=await hashPassword(input.password),id=randomUUID();
   try{db.prepare('INSERT INTO accounts(id,phone,password_hash,created_at) VALUES(?,?,?,?)').run(id,phone,hash,new Date().toISOString());}
   catch(error){if(db.prepare('SELECT id FROM accounts WHERE phone=?').get(phone))throw fail('该手机号已注册，请直接登录',409);throw error;}
   return issueSession(byId(id));
  },
  async login(input){
   const phone=normalizePhone(input.phone);
   if(typeof input.password!=='string'||input.password.length>128)throw fail('手机号或密码不正确',401);
   const u=db.prepare('SELECT * FROM accounts WHERE phone=?').get(phone);
   const valid=await verifyPassword(input.password,u?.password_hash);
   if(!u||!valid)throw fail('手机号或密码不正确',401);
   if(byId(u.id).password_version!==u.password_version)throw fail('密码已变更，请重新登录',401);
   return issueSession(u);
  },
  async changePassword(actor,input){
   validatePassword(input.password);
   if(typeof input.currentPassword!=='string'||input.currentPassword.length>128)throw fail('当前密码不正确');
   if(input.password===input.currentPassword)throw fail('新密码不能与当前密码相同');
   const u=byId(actor.id);
   if(!u||!await verifyPassword(input.currentPassword,u.password_hash))throw fail('当前密码不正确');
   const hash=await hashPassword(input.password);setPassword(u,hash,false,actor.id);
   return issueSession(byId(u.id));
  },
  listUsers(actor){if(actor.role!=='admin')throw fail('仅管理员可操作',403);return db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all().map(publicUser);},
  async resetPassword(actor,targetId){
   if(actor.role!=='admin')throw fail('仅管理员可操作',403);
   if(targetId===actor.id)throw fail('请通过“修改密码”修改自己的密码');
   const u=byId(String(targetId));if(!u)throw fail('用户不存在',404);
   const temporaryPassword='Zx'+randomBytes(12).toString('base64url')+'aB';
   const hash=await hashPassword(temporaryPassword);setPassword(u,hash,true,actor.id);
   return {user:publicUser(byId(u.id)),temporaryPassword};
  },
  logout(req){db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(readToken(req)));return cookieHeader('',0);},
 };
}
