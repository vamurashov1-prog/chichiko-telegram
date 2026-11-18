import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { outcome } from './game.js';
import { verifyInitData } from './auth.js';

test('камень побеждает ножницы',()=>assert.equal(outcome('rock','scissors'),'win'));
test('ножницы побеждают бумагу',()=>assert.equal(outcome('scissors','paper'),'win'));
test('бумага побеждает камень',()=>assert.equal(outcome('paper','rock'),'win'));
test('одинаковые ходы дают ничью',()=>assert.equal(outcome('paper','paper'),'draw'));
test('проигрыш определён корректно',()=>assert.equal(outcome('rock','paper'),'lose'));
test('все три циклических проигрыша корректны',()=>{
  assert.equal(outcome('scissors','rock'),'lose');assert.equal(outcome('paper','scissors'),'lose');assert.equal(outcome('rock','paper'),'lose');
});
function signedInitData(token,fields){
  const entries=Object.entries(fields).sort(([a],[b])=>a.localeCompare(b));
  const check=entries.map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
  const hash=crypto.createHmac('sha256',secret).update(check).digest('hex');
  return new URLSearchParams([...entries,['hash',hash]]).toString();
}
test('подпись Telegram initData проверяется, пользователь возвращается',()=>{
  const token='123456:TEST_TOKEN';const now=Date.now();const data=signedInitData(token,{auth_date:String(Math.floor(now/1000)),query_id:'query',user:JSON.stringify({id:42,first_name:'Тест',username:'tester'}),signature:'signed-field'});
  assert.deepEqual(verifyInitData(data,token,now),{id:'42',name:'Тест',username:'tester'});
});
test('изменённые initData отклоняются',()=>{
  const token='123456:TEST_TOKEN';const now=Date.now();const data=signedInitData(token,{auth_date:String(Math.floor(now/1000)),user:JSON.stringify({id:42,first_name:'Тест'})});const changed=new URLSearchParams(data);changed.set('user',JSON.stringify({id:42,first_name:'Хакер'}));
  assert.throws(()=>verifyInitData(changed.toString(),token,now),/Подпись Telegram/);
});
test('просроченные initData отклоняются',()=>{
  const token='123456:TEST_TOKEN';const now=Date.now();const data=signedInitData(token,{auth_date:String(Math.floor(now/1000)-90000),user:JSON.stringify({id:42,first_name:'Тест'})});
  assert.throws(()=>verifyInitData(data,token,now),/Сессия Telegram/);
});
