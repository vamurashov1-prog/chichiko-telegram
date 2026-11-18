import crypto from 'node:crypto';

const safeEqual=(a,b)=>{const x=Buffer.from(a);const y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const displayName=u=>[u.first_name,u.last_name].filter(Boolean).join(' ')||(u.username?`@${u.username}`:'Игрок');

export function verifyInitData(initData,token,now=Date.now()){
  if(!token)throw Object.assign(new Error('Сервер ещё не настроен: отсутствует BOT_TOKEN.'),{status:503});
  if(typeof initData!=='string'||!initData)throw Object.assign(new Error('Telegram не передал данные авторизации. Открой игру из Telegram.'),{status:401});
  const params=new URLSearchParams(initData);const hash=params.get('hash');
  if(!hash)throw Object.assign(new Error('Нет подписи Telegram.'),{status:401});
  // Telegram's bot-token HMAC check excludes only `hash`; `signature`, when present,
  // remains part of the data-check string.
  params.delete('hash');
  const dataCheck=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
  const expected=crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');
  if(!safeEqual(expected,hash))throw Object.assign(new Error('Подпись Telegram не прошла проверку.'),{status:401});
  const authDate=Number(params.get('auth_date')||0);
  if(!authDate||now/1000-authDate>86400||authDate>now/1000+60)throw Object.assign(new Error('Сессия Telegram устарела или имеет неверную дату. Закрой и заново открой игру.'),{status:401});
  let user;try{user=JSON.parse(params.get('user')||'{}')}catch{throw Object.assign(new Error('Не удалось прочитать профиль Telegram.'),{status:401})}
  if(!user.id)throw Object.assign(new Error('Telegram не передал ID игрока.'),{status:401});
  return{id:String(user.id),name:displayName(user),username:user.username||null};
}
