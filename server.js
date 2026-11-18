import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { outcome } from './game.js';
import { verifyInitData as validateTelegramInitData } from './auth.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.BOT_TOKEN || '';
const BOT_API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : '';
const STORE = path.join(__dirname, 'data', 'rooms.json');
const rooms = new Map();
let offset = 0;
let botUsername = 'RPSKO_bot';
let saveChain = Promise.resolve();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanName = u => [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? `@${u.username}` : 'Игрок');

async function loadRooms(){
  try { const data=JSON.parse(await fs.readFile(STORE,'utf8')); for(const r of data) rooms.set(r.id,r); }
  catch(e){ if(e.code!=='ENOENT') console.error('Не удалось прочитать rooms.json:',e.message); }
}
function persist(){
  const snapshot=JSON.stringify([...rooms.values()],null,2);
  saveChain=saveChain.then(async()=>{ await fs.mkdir(path.dirname(STORE),{recursive:true}); const tmp=STORE+'.tmp'; await fs.writeFile(tmp,snapshot); await fs.rename(tmp,STORE); }).catch(e=>console.error('Ошибка сохранения:',e.message));
  return saveChain;
}
async function tg(method,payload={}){
  const res=await fetch(`${BOT_API}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const json=await res.json().catch(()=>({ok:false,description:'Некорректный ответ Telegram'}));
  if(!res.ok||!json.ok) throw new Error(json.description||`Telegram ${method}: HTTP ${res.status}`);
  return json.result;
}
async function send(chat_id,text,reply_markup){ return tg('sendMessage',{chat_id,text, ...(reply_markup?{reply_markup}:{}), disable_web_page_preview:true}); }
function displayTarget(msg){
  const parts=(msg.text||'').trim().split(/\s+/);
  if(parts[1]?.startsWith('@')) return {username:parts[1].slice(1).toLowerCase(), userId:null};
  const replied=msg.reply_to_message?.from;
  if(replied && !replied.is_bot) return {username:replied.username?.toLowerCase()||null,userId:String(replied.id),name:cleanName(replied)};
  return null;
}
function newId(){ return crypto.randomBytes(6).toString('hex'); }
function duelLink(id){ return `https://t.me/${botUsername}?startapp=${encodeURIComponent(id)}`; }
function commandOf(text=''){ return text.trim().split(/\s+/,1)[0].split('@')[0].toLowerCase(); }
async function onMessage(m){
  const text=m.text||''; const cmd=commandOf(text);
  if(cmd==='/start'||cmd==='/help'){
    const inGroup=['group','supergroup'].includes(m.chat.type);
    await send(m.chat.id, inGroup
      ? 'ЧИЧИКО готово к дуэли. Напиши /duel@'+botUsername+' @username или ответь командой /duel@'+botUsername+' на сообщение соперника.'
      : 'ЧИЧИКО — дуэли в камень, ножницы, бумага. Добавь бота в групповой чат и вызови соперника командой /duel@'+botUsername+' @username.');
    return;
  }
  if(cmd!=='/duel') return;
  if(!['group','supergroup'].includes(m.chat.type)){ await send(m.chat.id,`Дуэль вызывается прямо в групповом чате. Добавь меня туда и напиши /duel@${botUsername} @username.`); return; }
  const target=displayTarget(m);
  if(!target || (!target.username && !target.userId)){ await send(m.chat.id,`Укажи соперника: /duel@${botUsername} @username\nИли ответь командой /duel@${botUsername} на его сообщение.`); return; }
  const me=m.from||{};
  if(target.userId && target.userId===String(me.id)){ await send(m.chat.id,'Самого себя вызвать нельзя. Найди достойного соперника.'); return; }
  if(target.username && me.username && target.username===me.username.toLowerCase()){ await send(m.chat.id,'Самого себя вызвать нельзя.'); return; }
  const id=newId();
  const room={id,chatId:m.chat.id,chatTitle:m.chat.title||'',status:'invite',createdAt:Date.now(),targetUsername:target.username,targetUserId:target.userId,players:[{id:String(me.id),name:cleanName(me),username:me.username||null,score:0,move:null}],round:1,history:[],winner:null};
  rooms.set(id,room); await persist();
  const targetLabel=target.username?`@${target.username}`:target.name;
  await send(m.chat.id,`⚔️ ${cleanName(me)} вызывает ${targetLabel} на дуэль в ЧИЧИКО!\n\nКамень · Ножницы · Бумага\nМатч до 3 побед. Без ставок — только скилл.`,{inline_keyboard:[[
    {text:'Принять вызов',callback_data:`a:${id}`},{text:'Отказаться',callback_data:`d:${id}`}
  ]]});
}
async function onCallback(q){
  const [action,id]=(q.data||'').split(':'); const r=rooms.get(id); const u=q.from||{};
  if(!r||r.status!=='invite'){ await tg('answerCallbackQuery',{callback_query_id:q.id,text:'Этот вызов уже закрыт.'}); return; }
  const isTarget=(r.targetUserId && String(u.id)===r.targetUserId) || (r.targetUsername && u.username?.toLowerCase()===r.targetUsername);
  if(!isTarget){ await tg('answerCallbackQuery',{callback_query_id:q.id,text:'Этот вызов адресован другому игроку.',show_alert:true}); return; }
  if(String(u.id)===r.players[0].id){ await tg('answerCallbackQuery',{callback_query_id:q.id,text:'Нельзя принять собственный вызов.'}); return; }
  if(action==='d'){
    r.status='declined'; await persist(); await tg('answerCallbackQuery',{callback_query_id:q.id,text:'Вызов отклонён.'});
    await tg('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:`Вызов ${r.targetUsername?`@${r.targetUsername}`:''} отклонён.`}); return;
  }
  if(action!=='a') return;
  r.players.push({id:String(u.id),name:cleanName(u),username:u.username||null,score:0,move:null}); r.status='playing'; await persist();
  await tg('answerCallbackQuery',{callback_query_id:q.id,text:'Вызов принят! Открывайте игру.'});
  const link=duelLink(r.id);
  await tg('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,
    text:`⚔️ ДУЭЛЬ ПРИНЯТА!\n\n${r.players[0].name} vs ${r.players[1].name}\nСчёт до 3 побед. Выбирайте ход одновременно.`,
    reply_markup:{inline_keyboard:[[{text:'Играть в ЧИЧИКО',url:link}]]}});
  await send(r.chatId,'Оба игрока могут открыть одну и ту же игровую комнату кнопкой выше.');
}
async function handleUpdate(u){ if(u.message) await onMessage(u.message); if(u.callback_query) await onCallback(u.callback_query); }
function verifyInitData(initData){ return validateTelegramInitData(initData,TOKEN); }
function roomForUser(id,user){ const r=rooms.get(id); if(!r) throw Object.assign(new Error('Дуэль не найдена. Возможно, сервер перезапускался или ссылка неверна.'),{status:404}); if(!r.players.some(p=>p.id===user.id)) throw Object.assign(new Error('Ты не участник этой дуэли.'),{status:403}); return r; }
function publicRoom(r,userId){
  return {id:r.id,status:r.status,round:r.round,players:r.players.map(p=>({id:p.id,name:p.name,score:p.score,hasMoved:!!p.move,isMe:p.id===userId})),history:r.history.slice(-8),winner:r.winner};
}
async function postRoundToChat(r,entry){
  const names=r.players.map(p=>p.name); const label={rock:'Камень',paper:'Бумага',scissors:'Ножницы'};
  let text=`Раунд ${entry.round}: ${names[0]} — ${label[entry.moves[0]]}, ${names[1]} — ${label[entry.moves[1]]}.\n`;
  if(entry.result==='draw') text+='Ничья!'; else text+=`${names[entry.result==='p1'?0:1]} забирает раунд.`;
  text+=`\nСчёт: ${r.players[0].score}:${r.players[1].score}`;
  if(r.status==='finished') text+=`\n\n🏆 Победитель дуэли: ${r.winner}!`;
  await send(r.chatId,text).catch(e=>console.error('Не удалось отправить результат в чат:',e.message));
}
function sendJson(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));}
async function readJson(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32768)throw Object.assign(new Error('Слишком большой запрос.'),{status:413});}try{return raw?JSON.parse(raw):{};}catch{throw Object.assign(new Error('Некорректный JSON.'),{status:400});}}
async function route(req,res){
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health')return sendJson(res,200,{ok:true,botConfigured:!!TOKEN,rooms:rooms.size});
  const match=url.pathname.match(/^\/api\/room\/([a-f0-9]{12})(\/move)?$/);
  if(match){
    const id=match[1];
    try{
      const user=verifyInitData(req.headers['x-telegram-init-data']); const r=roomForUser(id,user);
      if(req.method==='GET'&&!match[2])return sendJson(res,200,publicRoom(r,user.id));
      if(req.method==='POST'&&match[2]){
        const body=await readJson(req);const move=body.move;
        if(!['rock','paper','scissors'].includes(move))return sendJson(res,400,{error:'Выбери камень, бумагу или ножницы.'});
        if(r.status!=='playing')return sendJson(res,409,{error:'Эта дуэль уже завершена или ещё не началась.'});
        const player=r.players.find(p=>p.id===user.id);if(player.move)return sendJson(res,409,{error:'Твой ход уже зафиксирован. Ждём соперника.'});
        player.move=move;const other=r.players.find(p=>p.id!==user.id);
        if(other.move){
          const a=outcome(r.players[0].move,r.players[1].move);const entry={round:r.round,moves:r.players.map(p=>p.move),result:a==='draw'?'draw':a==='win'?'p1':'p2'};
          if(a==='win')r.players[0].score++;if(a==='lose')r.players[1].score++;
          r.history.push(entry);r.players.forEach(p=>p.move=null);
          if(r.players.some(p=>p.score>=3)){r.status='finished';r.winner=r.players.find(p=>p.score>=3).name;}else r.round++;
          await persist();await postRoundToChat(r,entry);
        }else await persist();
        return sendJson(res,200,publicRoom(r,user.id));
      }
      return sendJson(res,405,{error:'Метод не поддерживается.'});
    }catch(e){return sendJson(res,e.status||500,{error:e.message});}
  }
  if(req.method==='GET'){
    const requested=url.pathname==='/'?'/index.html':url.pathname;
    const file=path.resolve(__dirname,'public',`.${requested}`);
    if(!file.startsWith(path.resolve(__dirname,'public')+path.sep))return sendJson(res,403,{error:'Forbidden'});
    try{const data=await fs.readFile(file);const ext=path.extname(file);const type=ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'application/octet-stream';res.writeHead(200,{'content-type':type,'cache-control':ext==='.html'?'no-cache':'public, max-age=3600'});return res.end(data);}catch{return sendJson(res,404,{error:'Not found'});}
  }
  return sendJson(res,404,{error:'Not found'});
}
const server=http.createServer((req,res)=>{route(req,res).catch(e=>{console.error('HTTP error:',e.message);if(!res.headersSent)sendJson(res,500,{error:'Внутренняя ошибка сервера.'});else res.destroy();});});

async function botLoop(){
  try{
    const me=await tg('getMe'); botUsername=me.username||botUsername;
    await tg('setMyCommands',{commands:[{command:'duel',description:'Вызвать соперника в дуэль'},{command:'help',description:'Как играть в ЧИЧИКО'}]});
    await tg('deleteWebhook',{drop_pending_updates:false});
    console.log(`Telegram-бот подключён: @${botUsername}`);
    while(true){
      try{const updates=await tg('getUpdates',{offset,timeout:25,allowed_updates:['message','callback_query']}); for(const u of updates){offset=u.update_id+1;try{await handleUpdate(u)}catch(e){console.error('Ошибка update:',e.message);}}}
      catch(e){console.error('Telegram polling:',e.message);await sleep(2500);}
    }
  }catch(e){console.error('Не удалось запустить Telegram-бота:',e.message);process.exitCode=1;}
}
await loadRooms();
server.listen(PORT,()=>console.log(`ЧИЧИКО web запущен на порту ${PORT}`));
if(TOKEN && process.env.DISABLE_BOT!=='1') botLoop();
else console.log('Режим без Telegram polling: задайте BOT_TOKEN и DISABLE_BOT=0 для включения бота.');
