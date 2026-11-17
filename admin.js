import {auth,db} from './firebase-config.js';
import {onAuthStateChanged,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {ref,onValue,runTransaction,update,get} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

// Firebase Authentication の「ユーザー UID」に置き換えてください。
const ADMIN_UID = 'REPLACE_WITH_YOUR_ADMIN_UID';
const $ = id => document.getElementById(id);
const root = ref(db,'streamQueue');
const defaults = {settings:{accepting:true,theme:'#8b5cf6',title:'参加者待機リスト',message:'参加希望は「!参加」とコメント！',youtubeUrl:'',twitchChannel:''},participants:[]};
let state = structuredClone(defaults),unsubscribe=null;
function notify(message){$('notice').textContent=message;}
function render(){
  const s=state.settings||defaults.settings;
  $('accepting').checked=!!s.accepting;
  $('statusLabel').textContent=s.accepting?'受付中':'受付終了';
  $('theme').value=/^#[0-9a-f]{6}$/i.test(s.theme)?s.theme:'#8b5cf6';
  $('themeHex').value=$('theme').value;
  for(const k of ['title','message','youtubeUrl','twitchChannel']) $(k).value=s[k]||'';
  const list=Array.isArray(state.participants)?state.participants:[];
  $('count').textContent=`${list.length}人待機中`;
  $('complete').disabled=list.length===0;
  $('queue').replaceChildren();
  list.forEach((p,i)=>{
    const row=document.createElement('div');row.className='queue-row';
    const index=document.createElement('span');index.className='index';index.textContent=String(i+1).padStart(2,'0');
    const name=document.createElement('span');name.className='name';name.textContent=p.name;
    const actions=document.createElement('div');actions.className='actions';
    for(const [label,action,disabled] of [['↑','up',i===0],['↓','down',i===list.length-1],['削除','delete',false]]){
      const b=document.createElement('button');b.textContent=label;b.type='button';b.disabled=disabled;
      if(action==='delete')b.className='danger';
      b.addEventListener('click',()=>changeQueue(action,p.id));actions.append(b);
    }
    row.append(index,name,actions);$('queue').append(row);
  });
}
async function changeQueue(action,id){
  try{
    const result=await runTransaction(ref(db,'streamQueue/participants'),current=>{
      const list=Array.isArray(current)?[...current]:[];
      const i=list.findIndex(p=>p.id===id);if(i<0)return;
      if(action==='delete'||action==='complete')list.splice(i,1);
      if(action==='up'&&i>0)[list[i-1],list[i]]=[list[i],list[i-1]];
      if(action==='down'&&i<list.length-1)[list[i],list[i+1]]=[list[i+1],list[i]];
      return list;
    });
    if(!result.committed)notify('更新されませんでした。');
  }catch(e){notify('待機列の更新に失敗: '+e.message);}
}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();try{notify('ログイン中…');await signInWithEmailAndPassword(auth,$('email').value,$('password').value);$('password').value='';notify('ログインしました');}catch(err){notify('ログイン失敗: '+err.message);}
});
$('logout').addEventListener('click',()=>signOut(auth));
onAuthStateChanged(auth,async user=>{
  if(unsubscribe){unsubscribe();unsubscribe=null;}
  const allowed=!!user&&user.uid===ADMIN_UID;
  $('loginPanel').hidden=allowed;$('adminPanel').hidden=!allowed;
  $('connection').textContent=allowed?'Firebase接続中':'未接続';
  if(user&&!allowed){notify('このアカウントには管理者権限がありません。');await signOut(auth);return;}
  if(!allowed)return;
  try{
    const snap=await get(root);
    if(!snap.exists())await update(root,defaults);
    unsubscribe=onValue(root,snapshot=>{
      const data=snapshot.val()||{};
      state={settings:{...defaults.settings,...(data.settings||{})},participants:Array.isArray(data.participants)?data.participants:[]};
      render();$('connection').textContent='同期中';
    },error=>notify('同期エラー: '+error.message));
  }catch(err){notify('データベースへの接続に失敗: '+err.message);}
});
$('addForm').addEventListener('submit',async e=>{
  e.preventDefault();const name=$('participantName').value.trim();if(!name)return;
  const id=crypto.randomUUID();
  try{
    const result=await runTransaction(ref(db,'streamQueue/participants'),current=>{
      const list=Array.isArray(current)?[...current]:[];
      if(list.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return;
      list.push({id,name,platform:'manual',createdAt:Date.now()});return list;
    });
    if(result.committed)$('participantName').value='';else notify('同じ名前がすでに登録されています。');
  }catch(err){notify('追加失敗: '+err.message);}
});
$('complete').addEventListener('click',()=>{const first=state.participants?.[0];if(first)changeQueue('complete',first.id);});
$('accepting').addEventListener('change',async e=>{
  try{await update(ref(db,'streamQueue/settings'),{accepting:e.target.checked});}catch(err){notify('受付状態の変更に失敗: '+err.message);render();}
});
$('theme').addEventListener('input',e=>$('themeHex').value=e.target.value);
$('themeHex').addEventListener('input',e=>{if(/^#[0-9a-f]{6}$/i.test(e.target.value))$('theme').value=e.target.value;});
$('saveSettings').addEventListener('click',async()=>{
  const theme=$('themeHex').value;
  if(!/^#[0-9a-f]{6}$/i.test(theme)){notify('カラーは #RRGGBB 形式で入力してください。');return;}
  const youtubeUrl=$('youtubeUrl').value.trim();
  if(youtubeUrl){try{const u=new URL(youtubeUrl);if(u.protocol!=='https:'||!['youtube.com','www.youtube.com','youtu.be','m.youtube.com'].includes(u.hostname))throw Error();}catch{notify('有効なYouTubeのHTTPS URLを入力してください。');return;}}
  const twitchChannel=$('twitchChannel').value.trim();
  if(twitchChannel&&!/^[a-zA-Z0-9_]{3,25}$/.test(twitchChannel)){notify('Twitchチャンネル名を確認してください。');return;}
  try{await update(ref(db,'streamQueue/settings'),{theme,title:$('title').value.trim(),message:$('message').value.trim(),youtubeUrl,twitchChannel});notify('設定を保存しました。');}
  catch(err){notify('保存失敗: '+err.message);}
});
