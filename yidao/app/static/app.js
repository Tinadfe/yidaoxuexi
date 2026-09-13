/* 医道学堂 · 前端逻辑 */
'use strict';

/* ---------------- 状态 ---------------- */
let today = null;          // /api/today 缓存
let queue = [];            // 学习队列（新卡 + 复习卡）
let qi = 0;                // 队列位置
let flipped = false;
let audioEl = null;       // 音频对象
const GONGFA = [
  {k:'baduanjin', n:'八段锦'},
  {k:'zhanzhuang', n:'站桩'},
  {k:'jingzuo',   n:'静坐'},
];
let gongfaSel = {item:'baduanjin', minutes:15};

const QUOTES = [
  '上工治未病，不治已病。——《黄帝内经》',
  '正气存内，邪不可干。——《黄帝内经》',
  '致虚极，守静笃。——《道德经》',
  '上善若水，水善利万物而不争。——《道德经》',
  '恬淡虚无，真气从之；精神内守，病安从来。——《黄帝内经》',
  '知足不辱，知止不殆。——《道德经》',
  '阳气者，若天与日。——《黄帝内经》',
  '圣人不治已病治未病。——《黄帝内经》',
];

/* ---------------- 工具 ---------------- */
const $ = id => document.getElementById(id);
function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(()=>t.classList.remove('show'), 2200);
}
async function api(path, opts){
  const res = await fetch(path, Object.assign({headers:{'Content-Type':'application/json'}}, opts||{}));
  if(!res.ok) throw new Error((await res.json().catch(()=>({detail:res.status}))).detail || '请求失败');
  return res.json();
}

/* ---------------- Tab ---------------- */
function go(p){
  document.querySelectorAll('.page').forEach(el=>el.classList.remove('active'));
  $('page-'+p).classList.add('active');
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.p===p));
  window.scrollTo(0,0);
  if(p==='learn') renderLearn();
  if(p==='gongfa') loadPractice();
  if(p==='me') loadStats();
  if(p==='shelf') loadShelf();
}

/* ---------------- 书架 ---------------- */
let shelfType = '';           // ''=全部
let shelfTimer = null;
const SHELF_CHIPS = [
  {k:'', n:'全部'},
  {k:'tao', n:'道德经'},
  {k:'tcm', n:'药材'},
  {k:'acup', n:'穴位'},
];
function renderShelfChips(){
  $('shelf-chips').innerHTML = SHELF_CHIPS.map(c=>
    `<span class="type-chip ${shelfType===c.k?'on':''}" onclick="pickShelfType('${c.k}')">${c.n}</span>`).join('');
}
function pickShelfType(k){ shelfType=k; renderShelfChips(); loadShelf(); }
function shelfSearch(){
  clearTimeout(shelfTimer);
  shelfTimer = setTimeout(loadShelf, 300);   // 防抖
}
async function loadShelf(){
  renderShelfChips();
  const q = $('shelf-q').value.trim();
  try{
    const r = await api(`/api/library?q=${encodeURIComponent(q)}&type=${shelfType}`);
    $('shelf-count').textContent = `共 ${r.total} 条`;
    $('shelf-list').innerHTML = r.items.length ? r.items.map(c=>
      `<div class="shelf-item" onclick="openCardDetail(${c.id})">
        <div class="si-main">
          <div class="si-title">${c.title}${c.has_audio?' <span class="si-audio">🔊</span>':''}</div>
          <div class="si-preview">${c.preview||c.subtitle||''}</div>
        </div>
        <span class="si-tag ${c.type}">${c.type_name}</span>
      </div>`).join('')
      : '<div class="empty-tip">没找到相关内容 · 换个关键词试试</div>';
  }catch(e){ toast('书架加载失败'); }
}

/* 卡片详情弹层 */
let cdCard = null, cdAudio = null;
async function openCardDetail(id){
  try{
    cdCard = await api(`/api/card/${id}`);
  }catch(e){ toast('加载失败'); return; }
  $('cd-cat').textContent = `${cdCard.type_name} · ${cdCard.category}`;
  $('cd-title').textContent = cdCard.title;
  $('cd-sub').textContent = cdCard.subtitle || '';
  let body = '';
  if(cdCard.front_text){
    body += `<div class="cd-front serif">${cdCard.front_text}</div>`;
  }
  body += '<dl>' + (cdCard.back||[]).map(r=>
    `<dt>${r[0]}</dt><dd class="${/记忆|读法|互证/.test(r[0])?'hook':''}">${r[1]}</dd>`).join('') + '</dl>';
  $('cd-body').innerHTML = body;
  stopCdAudio();
  $('cd-audio-row').style.display = cdCard.audio_url ? 'flex' : 'none';
  $('cd-audio-btn').textContent = '▶ 原文 + 白话';
  $('card-overlay').classList.add('show');
}
function closeCardDetail(){
  $('card-overlay').classList.remove('show');
  stopCdAudio(); cdCard = null;
}
function toggleCdAudio(ev){
  ev.stopPropagation();
  if(!cdCard || !cdCard.audio_url) return;
  const btn = $('cd-audio-btn');
  if(cdAudio){ stopCdAudio(); btn.textContent='▶ 原文 + 白话'; return; }
  cdAudio = new Audio(cdCard.audio_url);
  cdAudio.onended = ()=>{ btn.textContent='▶ 原文 + 白话'; cdAudio=null; };
  cdAudio.onerror = ()=>{ toast('音频加载失败'); cdAudio=null; };
  cdAudio.play().catch(()=>toast('音频加载失败'));
  btn.textContent = '❚❚ 暂停';
}
function stopCdAudio(){ if(cdAudio){ cdAudio.pause(); cdAudio=null; } }
function askFromCard(){
  if(!cdCard) return;
  const cid = cdCard.id, t = cdCard.title;
  closeCardDetail();
  openAsk(cid, t);
}

/* ---------------- AI 问答 ---------------- */
let askCardId = 0, chatBusy = false;
function openAsk(cardId, cardTitle){
  askCardId = cardId || 0;
  $('ask-overlay').classList.add('show');
  const list = $('chat-list');
  if(!list.dataset.loaded){
    list.dataset.loaded = '1';
    renderChatMsg('ai', cardId
      ? `这一张是「${cardTitle}」。有什么想问的？比如功效原理、相近药材对比、章节大意都可以。`
      : '我是医道学堂的 AI 助教 🌿 关于药材、穴位、道德经的问题都可以问我。');
  }
  setTimeout(()=>$('chat-input').focus(), 100);
}
function closeAsk(){ $('ask-overlay').classList.remove('show'); }
function renderChatMsg(role, text, pending){
  const div = document.createElement('div');
  div.className = `chat-msg ${role}` + (pending?' pending':'');
  div.innerHTML = `<div class="bubble"></div>`;
  div.querySelector('.bubble').textContent = text;
  $('chat-list').appendChild(div);
  $('chat-list').scrollTop = $('chat-list').scrollHeight;
  return div;
}
async function submitAsk(){
  if(chatBusy) return;
  const inp = $('chat-input');
  const q = inp.value.trim();
  if(!q){ return; }
  inp.value = '';
  renderChatMsg('me', q);
  chatBusy = true;
  $('chat-send').textContent = '…';
  const pend = renderChatMsg('ai', '思考中…', true);
  try{
    const r = await api('/api/ask', {method:'POST', body: JSON.stringify({question:q, card_id:askCardId})});
    pend.querySelector('.bubble').textContent = r.answer;
    pend.classList.remove('pending');
  }catch(e){
    pend.querySelector('.bubble').textContent = '发送失败，检查网络后重试。';
    pend.classList.remove('pending');
  }finally{
    chatBusy = false;
    $('chat-send').textContent = '发送';
    $('chat-list').scrollTop = $('chat-list').scrollHeight;
  }
}

/* ---------------- 今日 ---------------- */
function renderToday(){
  if(!today) return;
  const cardsDone = today.cards_done, pDone = today.practice_done;
  const n = (cardsDone?1:0) + (pDone?1:0);
  const pct = Math.round(n/2*100);
  $('ring').style.background = `conic-gradient(var(--gold-light) 0 ${pct}%, #e5ebf2 ${pct}% 100%)`;
  $('ring-num').textContent = pct + '%';
  $('today-sub').textContent = pct>=100 ? '今日功德圆满 ✨ 明日再会'
    : `新卡 ${today.new_cards.length} · 复习 ${today.review_cards.length} · 功法${pDone?'已练':'未练'}`;

  const tc = $('task-card');
  tc.classList.toggle('done', cardsDone);
  $('task-card-btn').outerHTML = cardsDone
    ? '<span class="done-tip" id="task-card-btn">已完成 ✓</span>'
    : '<span class="m-chip chip-blue" id="task-card-btn">去学习</span>';
  const next = today.new_cards[0] || today.review_cards[0];
  $('task-card-type').textContent = next ? next.category : '';
  $('task-card-desc').textContent = cardsDone
    ? '今日卡组已学毕'
    : (today.new_cards.length + today.review_cards.length) + ' 张待学 · 点按翻卡';

  const tp = $('task-practice');
  tp.classList.toggle('done', pDone);
  $('task-practice-btn').outerHTML = pDone
    ? '<span class="done-tip" id="task-practice-btn">已打卡 ✓</span>'
    : '<span class="m-chip chip-gold" id="task-practice-btn">去练功</span>';
  $('task-practice-desc').textContent = pDone
    ? `连续 ${today.streak} 天 🔥`
    : `连续 ${today.streak} 天 · 点断就重来了`;

  const q = QUOTES[new Date().getDate() % QUOTES.length];
  $('daily-quote').textContent = q;
}
document.head.appendChild(Object.assign(document.createElement('style'),{textContent:'.done-tip{font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;background:var(--green-bg,#e8f5ec);color:var(--green,#2e7d4f);white-space:nowrap;}'}));

async function loadToday(){
  try{
    today = await api('/api/today');
    queue = today.new_cards.concat(today.review_cards);
    qi = 0;
    renderToday();
  }catch(e){ toast('加载失败，下拉重试'); }
}

/* ---------------- 学习（翻卡） ---------------- */
function renderLearn(){
  if(!today){ loadToday(); return; }
  const allDone = today.cards_done || queue.length===0;
  if(allDone){
    $('deck-meta').style.display='none';
    document.querySelector('.deck-wrap').style.display='none';
    document.querySelector('.btn-row').style.display='none';
    $('audio-row').style.display='none';
    $('learn-finish').style.display='block';
    $('learn-head').textContent='今日已完成';
    $('finish-sub').textContent = queue.length===0 && today.plan===0
      ? '内容库全部学完一轮——复习队列会持续安排重逢'
      : '新卡与复习都已过完 · 明日艾宾浩斯准时安排';
    return;
  }
  showCard();
}
function showCard(){
  const c = queue[qi];
  if(!c) { renderLearn(); return; }
  $('deck-meta').style.display='flex';
  document.querySelector('.deck-wrap').style.display='block';
  document.querySelector('.btn-row').style.display='flex';
  $('learn-finish').style.display='none';

  $('deck-label').textContent = `第 ${qi+1} / ${queue.length} 张 · ${c.category}`;
  $('dots').innerHTML = queue.map((_,i)=>`<i class="${i<=qi?'on':''}"></i>`).join('');

  const f = $('face-front');
  f.className = 'face front' + (c.type==='tao' ? ' tao' : '');
  f.innerHTML =
    `<span class="cat">${c.category}</span>` +
    (c.is_review ? `<span class="review-badge">复习</span>` : '') +
    (c.front_text
      ? `<div class="serif" style="font-size:17px;letter-spacing:2px;margin-top:6px">${c.title}</div>
         <div class="long-text">${c.front_text}</div>
         <div class="tap">点 击 翻 面 看 白 话</div>`
      : `<div class="big serif">${c.title}</div>
         <div class="py">${c.subtitle||''}</div>
         <div class="q">${c.front_hint||''}</div>
         <div class="tap">点 击 翻 面</div>`);

  $('face-back').innerHTML =
    `<div class="bt">${c.title} · 答案</div><dl>` +
    c.back.map(r=>`<dt>${r[0]}</dt><dd class="${/记忆|读法|互证/.test(r[0])?'hook':''}">${r[1]}</dd>`).join('') +
    `</dl>`;

  // 音频按钮
  stopAudio();
  if(c.audio_url){
    $('audio-row').style.display='flex';
    $('audio-btn').textContent='▶ 原文 + 白话';
    $('audio-btn').classList.remove('playing');
  }else{
    $('audio-row').style.display='none';
  }

  $('flashcard').classList.remove('flipped');
  flipped = false;
  $('btn-again').classList.add('lock'); $('btn-got').classList.add('lock');
}
function flip(){
  $('flashcard').classList.add('flipped');
  flipped = true;
  $('btn-again').classList.remove('lock'); $('btn-got').classList.remove('lock');
}
function flipBack(){
  $('flashcard').classList.remove('flipped');
  flipped = false;
}
async function gotIt(){
  if(!flipped) return;
  const c = queue[qi];
  try{ await api('/api/review', {method:'POST', body: JSON.stringify({card_id:c.id, result:'got'})}); }catch(e){ toast('提交失败，重试一下'); return; }
  nextCard();
}
async function again(){
  if(!flipped) return;
  const c = queue[qi];
  try{ await api('/api/review', {method:'POST', body: JSON.stringify({card_id:c.id, result:'again'})}); }catch(e){ toast('提交失败，重试一下'); return; }
  // 「再看看」：提交后移到队尾，本队稍后再见
  const cur = queue.splice(qi,1)[0];
  cur.is_review = true;
  queue.push(cur);
  showCard();  // splice 后原位置已是下一张；若本是最后一张，队尾仍是它
}
function nextCard(){
  qi++;
  if(qi >= queue.length){
    today.cards_done = true;
    renderLearn(); renderToday();
    toast('今日卡片完成 🌿');
  }else{
    showCard();
  }
}

/* ---------------- 音频 ---------------- */
function stopAudio(){
  if(audioEl){ audioEl.pause(); audioEl=null; }
}
function toggleAudio(ev){
  ev.stopPropagation();
  const c = queue[qi];
  if(!c || !c.audio_url) return;
  const btn = $('audio-btn');
  if(audioEl){
    stopAudio();
    btn.textContent='▶ 原文 + 白话'; btn.classList.remove('playing');
    return;
  }
  audioEl = new Audio(c.audio_url);
  audioEl.onended = ()=>{ btn.textContent='▶ 原文 + 白话'; btn.classList.remove('playing'); audioEl=null; };
  audioEl.onerror = ()=>{ toast('音频加载失败'); audioEl=null; };
  audioEl.play().catch(()=>toast('音频加载失败'));
  btn.textContent='❚❚ 暂停'; btn.classList.add('playing');
}

/* ---------------- 功法 ---------------- */
function renderGongfaPickers(){
  $('gongfa-types').innerHTML = GONGFA.map(g=>
    `<span class="type-chip ${gongfaSel.item===g.k?'on':''}" onclick="pickItem('${g.k}')">${g.n}</span>`).join('');
  const MIN = [5,10,15,20,30];
  $('gongfa-minutes').innerHTML = MIN.map(m=>
    `<span class="type-chip min ${gongfaSel.minutes===m?'on':''}" onclick="pickMin(${m})">${m}</span>`).join('');
}
function pickItem(k){ gongfaSel.item=k; renderGongfaPickers(); }
function pickMin(m){ gongfaSel.minutes=m; renderGongfaPickers(); }

async function loadPractice(){
  renderGongfaPickers();
  if(today){
    $('streak-num').textContent = today.streak;
    const st = $('today-practice-state');
    st.textContent = today.practice_done ? '今日已练 ✓' : '今日未练';
    st.classList.toggle('done', today.practice_done);
  }
  try{
    const hist = await api('/api/practice/history');
    $('practice-history').innerHTML = hist.length
      ? hist.map(h=>`<div class="hist-item"><div><div class="n">${h.item_name} <span class="m">${h.minutes} 分钟</span></div></div><span class="t">${h.time}</span></div>`).join('')
      : '<div class="empty-tip">还没有记录 · 从今天开始</div>';
  }catch(e){}
}
async function doCheckin(){
  if(today && today.practice_done){ toast('今天已经打过卡啦'); return; }
  const btn = $('checkin-btn');
  btn.textContent = '打卡中…'; btn.classList.add('breath'); btn.style.pointerEvents='none';
  try{
    const r = await api('/api/practice/checkin', {method:'POST', body: JSON.stringify(gongfaSel)});
    toast(`打卡成功 · 连续 ${r.streak} 天 🔥`);
    await loadToday();
    await loadPractice();
  }catch(e){
    toast('打卡失败，重试一下');
  }finally{
    btn.textContent = '完成打卡'; btn.classList.remove('breath'); btn.style.pointerEvents='';
  }
}

/* ---------------- 我的 ---------------- */
async function loadStats(){
  try{
    const s = await api('/api/stats');
    $('st-learned').textContent = s.learned;
    $('st-tao').textContent = s.tao_progress;
    $('st-pct').textContent = s.learn_pct + '%';
    $('breakdown').innerHTML = s.breakdown.map(b=>{
      const pct = b.total ? Math.round(b.learned/b.total*100) : 0;
      return `<div class="bd-row">
        <div class="bd-head"><span class="n">${b.category}</span><span class="v">${b.learned} / ${b.total}</span></div>
        <div class="bd-bar"><div class="bd-fill" data-pct="${pct}"></div></div>
      </div>`;
    }).join('');
    setTimeout(()=>document.querySelectorAll('.bd-fill').forEach(el=>el.style.width=el.dataset.pct+'%'), 60);
  }catch(e){ toast('统计加载失败'); }
}

/* ---------------- 启动 ---------------- */
const d = new Date();
const WEEK = ['日','一','二','三','四','五','六'];
$('today-date').textContent = `${d.getFullYear()} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日 · 星期${WEEK[d.getDay()]}`;
loadToday();

/* Service Worker（PWA 离线缓存） */
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
