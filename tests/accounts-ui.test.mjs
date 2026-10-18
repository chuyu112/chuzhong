import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
test('admin UI resets a user, who must choose a new password before chatting',{timeout:60000},async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'zhixu-ui-accounts-'));
 const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,EDU_DATA_DIR:dir,EDU_PORT:'0',EDU_HOST:'127.0.0.1',EDU_ADMIN_PHONE:'19900000021',EDU_ADMIN_INITIAL_PASSWORD:'AdminInitial123',EDU_COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});
 let browser;
 try{
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),15000);child.stdout.on('data',v=>{const m=String(v).match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await mkdir(path.join(root,'artifacts'),{recursive:true});
  await page.goto(url);await page.locator('#auth-register-tab').click();await page.screenshot({path:path.join(root,'artifacts/registration-desktop.png')});
  await page.locator('#auth-phone').fill('19900000022');await page.locator('#auth-password').fill('StudentPass123');await page.locator('#auth-confirm').fill('StudentPass123');await page.locator('#auth-submit').click();await page.locator('#login-dialog').waitFor({state:'hidden'});await page.locator('#tutor.active').waitFor();
  await page.locator('#chat-welcome').waitFor();assert.equal(await page.locator('#chat-input').isVisible(),true);await page.screenshot({path:path.join(root,'artifacts/chat-first-desktop.png'),fullPage:true});
  await page.locator('#account-open').click();await page.locator('#logout').click();await page.locator('#login-dialog').waitFor({state:'visible'});
  await page.locator('#forgot-password').click();assert.match(await page.locator('#forgot-help').innerText(),/管理员/);
  await page.locator('#auth-phone').fill('19900000021');await page.locator('#auth-password').fill('AdminInitial123');await page.locator('#auth-submit').click();await page.locator('#password-dialog').waitFor({state:'visible'});
  await page.locator('#current-password').fill('AdminInitial123');await page.locator('#new-password').fill('AdminChanged123');await page.locator('#confirm-password').fill('AdminChanged123');await page.locator('#password-form button').click();await page.locator('#password-dialog').waitFor({state:'hidden'});
  await page.locator('#account-open').click();await page.locator('#admin-open').click();await page.locator('.admin-user').first().waitFor();await page.screenshot({path:path.join(root,'artifacts/admin-users-desktop.png')});
  await page.locator('.admin-user').filter({hasText:'19900000022'}).getByRole('button',{name:'重置密码'}).click();await page.locator('#reset-confirm').click();await page.locator('#reset-result').waitFor({state:'visible'});const temporary=await page.locator('#temporary-password').inputValue();assert.ok(temporary.length>=8);await page.locator('#reset-close').click();await page.waitForFunction(()=>document.querySelector('#temporary-password').value==='');await page.locator('#admin-close').click();await page.locator('#account-open').click();await page.locator('#logout').click();
  await page.locator('#auth-phone').fill('19900000022');await page.locator('#auth-password').fill(temporary);await page.locator('#auth-submit').click();await page.locator('#password-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#password-cancel').isVisible(),false);await page.keyboard.press('Escape');assert.equal(await page.locator('#password-dialog').isVisible(),true);
  await page.locator('#current-password').fill(temporary);await page.locator('#new-password').fill('StudentChanged123');await page.locator('#confirm-password').fill('StudentChanged123');await page.locator('#password-form button').click();await page.locator('#password-dialog').waitFor({state:'hidden'});await page.locator('#tutor.active').waitFor();assert.equal(await page.locator('#chat-input').isVisible(),true);assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});await rm(dir,{recursive:true,force:true});}
});
