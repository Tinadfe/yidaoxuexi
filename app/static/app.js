/* 医道学堂 · 前端逻辑 */
'use strict';

/* ---------------- 状态 ---------------- */
let today = null;          // /api/today 缓存
let queue = [];            // 学习队列（新卡 + 复习卡）
let qi = 0;                // 队列位置
let flipped = false;
let audioEl = null;       // 音频对象
let myType = '';
let consTab='quiz';
let gfData={};   // 功法详解缓存           // 我的体质码（P/A/.../H），测过才有
const GONGFA = [
  {k:'baduanjin', n:'八段锦'},
  {k:'zhanzhuang', n:'站桩'},
  {k:'jingzuo',   n:'静坐'},
];
let gongfaSel = {item:'zhanzhuang', minutes:15};   // 默认站桩（重点讲解项）

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
  {k:'tcm', n:'药材'},
  {k:'patent', n:'中成药'},
  {k:'acup', n:'穴位'},
  {k:'tao', n:'道德经'},
];

/* 体质角标：测过体质且该卡有宜忌 → 返回角标 HTML */
function fitBadge(c){
  if(!myType || !c.suit || !c.avoid) return '';
  if(c.suit.includes(myType)) return ' <span class="fit-badge">✅ 宜</span>';
  if(c.avoid.includes(myType)) return ' <span class="avoid-badge">⚠️ 忌</span>';
  return ' <span class="neutral-badge">—</span>';
}
/* 详情/学习卡的体质匹配块 */
function fitBlock(c){
  if(!myType || !c.suit || !c.avoid) return '';
  let cls, icon, label, note;
  if(c.suit.includes(myType)){
    cls='ok'; icon='✅'; label='适合你的体质';
    note = c.suit_note || '';
  }else if(c.avoid.includes(myType)){
    cls='no'; icon='⚠️'; label='你的体质需慎用';
    note = c.avoid_note || '';
  }else{
    cls='mid'; icon='ℹ️'; label='与你的体质无明确宜忌';
    note = c.suit_note || '按需使用，拿不准就问一问 AI 助教。';
  }
  return `<div class="cd-fit ${cls}"><b>${icon} ${label}</b><span>${note}</span></div>`;
}
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
          <div class="si-title">${c.title}${c.has_audio?' <span class="si-audio">🔊</span>':''}${fitBadge(c)}</div>
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
  body += fitBlock(cdCard);
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
async function toggleCdAudio(ev){
  ev.stopPropagation();
  if(!cdCard || !cdCard.audio_url) return;
  const btn = $('cd-audio-btn');
  if(cdAudio){ stopCdAudio(); btn.textContent='▶ 原文 + 白话'; return; }
  btn.textContent = '⏳ 加载中…';
  try{
    const src = await audioSrc(cdCard.audio_url);
    cdAudio = new Audio(src);
    cdAudio.onended = ()=>{ btn.textContent='▶ 原文 + 白话'; btn.classList.remove('playing'); cdAudio=null; };
    cdAudio.onerror = ()=>{ toast('音频加载失败'); btn.textContent='▶ 原文 + 白话'; cdAudio=null; };
    await cdAudio.play();
    btn.textContent = '❚❚ 暂停';
  }catch(e){
    btn.textContent='▶ 原文 + 白话';
    toast('音频加载失败');
    cdAudio = null;
  }
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
    fitBadge(c) +
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

/* ---------------- 音频 ----------------
   服务器（Railway 边缘）会吞掉 Range 请求头，iOS Safari 探测不到 206 就拒绝播放。
   这里改为：fetch 整个文件 → Blob URL → 播放，全程不依赖 Range。
--------------------------------------- */
const AUDIO_BLOB = {};          // 原始 url -> blob url 缓存
let audioUnlocked = false;

/* iOS 要求用户手势内同步调用过一次 play()，之后异步播放才被允许 */
function unlockAudio(){
  if(audioUnlocked) return;
  try{
    const a = new Audio();
    a.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    a.muted = true;
    const p = a.play();
    if(p && p.then) p.then(()=>{ audioUnlocked = true; }).catch(()=>{});
    else audioUnlocked = true;
  }catch(e){}
}
['touchstart','click'].forEach(ev =>
  document.addEventListener(ev, unlockAudio, { once:true, passive:true, capture:true }));

/* 把音频抓成 Blob（普通 GET，不需要 206），并缓存 */
async function audioSrc(url){
  if(AUDIO_BLOB[url]) return AUDIO_BLOB[url];
  const res = await fetch(url);
  if(!res.ok) throw new Error('HTTP ' + res.status);
  AUDIO_BLOB[url] = URL.createObjectURL(await res.blob());
  return AUDIO_BLOB[url];
}

function stopAudio(){
  if(audioEl){ audioEl.pause(); audioEl=null; }
}
async function toggleAudio(ev){
  ev.stopPropagation();
  const c = queue[qi];
  if(!c || !c.audio_url) return;
  const btn = $('audio-btn');
  if(audioEl){
    stopAudio();
    btn.textContent='▶ 原文 + 白话'; btn.classList.remove('playing');
    return;
  }
  btn.textContent = '⏳ 加载中…';
  try{
    const src = await audioSrc(c.audio_url);
    audioEl = new Audio(src);
    audioEl.onended = ()=>{ btn.textContent='▶ 原文 + 白话'; btn.classList.remove('playing'); audioEl=null; };
    audioEl.onerror = ()=>{ toast('音频加载失败'); btn.textContent='▶ 原文 + 白话'; audioEl=null; };
    await audioEl.play();
    btn.textContent='❚❚ 暂停'; btn.classList.add('playing');
  }catch(e){
    btn.textContent='▶ 原文 + 白话';
    toast('音频加载失败');
    audioEl = null;
  }
}

/* ---------------- 功法 ---------------- */
function renderGongfaPickers(){
  $('gongfa-types').innerHTML = GONGFA.map(g=>
    `<span class="type-chip ${gongfaSel.item===g.k?'on':''}" onclick="pickItem('${g.k}')">${g.n}</span>`).join('');
  const MIN = [5,10,15,20,30];
  $('gongfa-minutes').innerHTML = MIN.map(m=>
    `<span class="type-chip min ${gongfaSel.minutes===m?'on':''}" onclick="pickMin(${m})">${m}</span>`).join('');
  renderGfGuide();
}
async function renderGfGuide(){
  const box = $('gf-guide');
  if(!box) return;
  const cur = GONGFA.find(g=>g.k===gongfaSel.item) || GONGFA[0];
  try{
    const r = await api('/api/gongfa?item=' + encodeURIComponent(cur.k));
    if(!r.ok){ box.innerHTML=''; return; }
    const d = r.data;
    const kp = (d.key_points||[]).slice(0,4);
    box.innerHTML =
      '<div class="gf-guide-inner">'
      + '<div class="gf-guide-name">' + (d.name||cur.n) + (d.alias ? ' · ' + d.alias : '') + '</div>'
      + '<div class="gf-guide-sub">' + (d.subtitle||'') + '</div>'
      + (kp.length ? '<div class="gf-guide-kp">'
          + kp.map(x=>'<span class="gf-kp">' + x + '</span>').join('')
        + '</div>' : '')
      + '<div class="gf-guide-btn" onclick="openGongfa(\'' + cur.k + '\')">查看完整详解 →</div>'
      + '</div>';
  }catch(e){ box.innerHTML=''; }
}
async function openGongfa(k){
  $('gf-overlay').classList.add('show');
  $('gf-body').innerHTML = '<div class="cons-loading">加载中…</div>';
  try{
    const r = await api('/api/gongfa?item=' + encodeURIComponent(k));
    if(!r.ok){ $('gf-body').innerHTML='<div class="cons-loading">'+(r.reason||'加载失败')+'</div>'; return; }
    gfData = r.data;
    renderGongfaDetail(gfData);
  }catch(e){
    $('gf-body').innerHTML = '<div class="cons-loading">网络异常</div>';
  }
}
function closeGongfa(){
  $('gf-overlay').classList.remove('show');
}
/* 把 **xxx** 转成 <b>xxx</b>（功法正文用） */
function mdBold(t){
  return String(t||'').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
function renderGongfaDetail(d){
  $('gf-title').textContent = (d.name||'功法') + (d.alias ? ' · ' + d.alias : '');
  let h = '';

  if(d.intro){
    h += '<div class="gf-card"><div class="gf-intro">' + mdBold(d.intro) + '</div></div>';
  }

  // 时长建议
  if(d.duration_advice && d.duration_advice.length){
    h += '<div class="gf-card"><div class="gf-ct">练多久合适</div>';
    d.duration_advice.forEach(x=>{
      h += '<div class="gf-dur"><span class="gf-dur-lv">' + x.level + '</span>'
         + '<span class="gf-dur-min">' + x.minutes + '</span>'
         + '<div class="gf-dur-note">' + x.note + '</div></div>';
    });
    h += '</div>';
  }

  // 姿势详解（核心）
  if(d.stance && d.stance.steps){
    h += '<div class="gf-card"><div class="gf-ct">' + (d.stance.title||'姿势详解') + '</div>';
    d.stance.steps.forEach(st=>{
      h += '<div class="gf-step' + (st.highlight ? ' imp' : '') + '">'
         +   '<div class="gf-step-hd">'
         +     '<span class="gf-step-n">' + st.part + '</span>'
         +     '<span class="gf-step-key">' + st.key + '</span>'
         +   '</div>'
         +   '<div class="gf-step-detail">' + mdBold(st.detail) + '</div>'
         +   (st.wrong ? '<div class="gf-step-wrong"><b>✗ 常见错误：</b>' + mdBold(st.wrong) + '</div>' : '')
         +   (st.check ? '<div class="gf-step-check"><b>✓ 自查：</b>' + mdBold(st.check) + '</div>' : '')
         + '</div>';
    });
    h += '</div>';
  }

  // 八段锦式子
  if(d.forms){
    h += '<div class="gf-card"><div class="gf-ct">八式</div>';
    d.forms.forEach((f,i)=>{ h += '<div class="gf-form">' + f + '</div>'; });
    h += '</div>';
  }

  // 要点
  if(d.key_points && d.key_points.length){
    h += '<div class="gf-card"><div class="gf-ct">核心要点</div><div class="gf-kps">'
       + d.key_points.map(x=>'<span class="gf-kp big">' + mdBold(x) + '</span>').join('')
       + '</div></div>';
  }

  // 常见错误
  if(d.common_mistakes && d.common_mistakes.length){
    h += '<div class="gf-card"><div class="gf-ct">常见错误与纠正</div>';
    d.common_mistakes.forEach(m=>{
      h += '<div class="gf-mistake"><div class="gf-mk-t">' + m.m + '</div>'
         + '<div class="gf-mk-why">' + mdBold(m.why) + '</div>'
         + '<div class="gf-mk-fix"><b>纠正：</b>' + mdBold(m.fix) + '</div></div>';
    });
    h += '</div>';
  }

  // 体感
  if(d.sensations && d.sensations.length){
    h += '<div class="gf-card"><div class="gf-ct">站桩中的感觉，正常吗</div>';
    d.sensations.forEach(x=>{
      const cls = (x.level === '异常') ? 'bad' : 'ok';
      h += '<div class="gf-sens ' + cls + '"><span class="gf-sens-s">' + x.s + '</span>'
         + '<span class="gf-sens-lv">' + x.level + '</span>'
         + '<div class="gf-sens-note">' + mdBold(x.note) + '</div></div>';
    });
    h += '</div>';
  }

  // 收功
  if(d.closing){
    h += '<div class="gf-card"><div class="gf-ct">' + (d.closing.title||'收功') + '</div>';
    d.closing.steps.forEach((x,i)=>{ h += '<div class="gf-close-step">' + (i+1) + '. ' + x + '</div>'; });
    if(d.closing.why){
      h += '<div class="gf-why"><b>为什么要收功：</b>' + d.closing.why + '</div>';
    }
    h += '</div>';
  }

  // 禁忌
  if(d.cautions && d.cautions.length){
    h += '<div class="gf-card caution"><div class="gf-ct">注意事项</div>';
    d.cautions.forEach(x=>{ h += '<div class="gf-cau">· ' + mdBold(x) + '</div>'; });
    h += '</div>';
  }

  // 小贴士
  if(d.tips && d.tips.length){
    h += '<div class="gf-card"><div class="gf-ct">小贴士</div>';
    d.tips.forEach(x=>{ h += '<div class="gf-tip">· ' + mdBold(x) + '</div>'; });
    h += '</div>';
  }

  if(d.note){
    h += '<div class="gf-card"><div class="gf-note">' + d.note + '</div></div>';
  }

  $('gf-body').innerHTML = h;
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

/* ---------------- 体质测试 ---------------- */
let consData = null;        // 问卷数据
let consAnswers = {};       // {qid: 1/2/3}
let consGroup = 0;          // 当前组（0~8，每组一型）
const CONS_ORDER = ['P','A','B','C','D','E','F','G','H'];

async function openCons(mode){
  $('cons-overlay').classList.add('show');
  $('cons-result').style.display = 'none';
  switchConsTab(mode || 'quiz');
  if(!consData){
    try{
      consData = await api('/api/constitution/questions');
    }catch(e){ toast('问卷加载失败'); return; }
  }
  consGroup = 0; consAnswers = {};
  renderConsGroup();
}
function switchConsTab(t){
  consTab = t;
  $('cons-quiz').style.display  = (t==='quiz')  ? 'block' : 'none';
  $('cons-birth').style.display = (t==='birth') ? 'block' : 'none';
  $('cons-tab-quiz').classList.toggle('on',  t==='quiz');
  $('cons-tab-birth').classList.toggle('on', t==='birth');
}
async function queryBirth(){
  const v = ($('cons-birth-input').value || '').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)){ toast('请选择出生日期'); return; }
  $('cons-birth-result').innerHTML = '<div class="cons-loading">推算中…</div>';
  try{
    const r = await api('/api/constitution/by-birth?date=' + encodeURIComponent(v));
    if(!r.ok){
      $('cons-birth-result').innerHTML = '<div class="cons-loading">' + (r.reason||'推算失败') + '</div>';
      return;
    }
    renderBirthResult(r);
  }catch(e){
    $('cons-birth-result').innerHTML = '<div class="cons-loading">网络异常，稍后再试</div>';
  }
}
function renderBirthResult(r){
  let h = '';
  h += '<div class="br-card">'
     +   '<div class="br-hero">'
     +     '<div class="br-hero-label">先天体质倾向</div>'
     +     '<div class="br-hero-name">' + (r.main_name||'—') + '</div>'
     +     (r.sub_types.length ? '<div class="br-hero-sub">兼见 ' + r.sub_types.map(x=>x.name).join('、') + '</div>' : '')
     +   '</div>'
     +   '<div class="br-row"><span>出生年</span><b>' + r.year + ' 年（' + r.gan + '年 · ' + r.yun + '）</b></div>'
     +   '<div class="br-row"><span>禀赋要点</span><b>' + r.summary + '</b></div>'
     +   '<div class="br-row"><span>脏腑强弱</span><b>' + r.weak_organ + '</b></div>'
     +   (r.type_note ? '<div class="br-row"><span>体质解读</span><b>' + r.type_note + '</b></div>' : '')
     + '</div>';

  if(r.season && r.season.name){
    h += '<div class="br-card season">'
       +   '<div class="br-card-title">' + r.season.name + '（' + r.season.organ + '·' + r.season.qi + '）</div>'
       +   '<div class="br-text">' + r.season.note + '</div>'
       +   '<div class="br-advice">' + r.season.advice + '</div>'
       + '</div>';
  }

  h += '<div class="br-card">'
     +   '<div class="br-card-title">调养建议</div>'
     +   '<div class="br-advice">' + r.advice + '</div>'
     +   (r.risk ? '<div class="br-risk"><b>易见问题：</b>' + r.risk + '</div>' : '')
     + '</div>';

  if(r.herb_ok && r.herb_ok.length){
    h += '<div class="br-card">'
       +   '<div class="br-card-title">相对适宜</div>'
       +   '<div class="br-herbs">'
       +   r.herb_ok.map(x=>'<span class="br-herb ok">' + x + '</span>').join('')
       +   '</div></div>';
  }
  const av = Object.keys(r.herb_avoid||{});
  if(av.length){
    h += '<div class="br-card">'
       +   '<div class="br-card-title">需谨慎</div>'
       +   '<div class="br-herbs">'
       +   av.map(x=>'<span class="br-herb no">' + x + '</span>').join('')
       +   '</div></div>';
  }

  h += '<div class="br-disclaimer">' + (r.disclaimer||'') + '</div>';
  $('cons-birth-result').innerHTML = h;
}
function closeCons(){ $('cons-overlay').classList.remove('show'); }

function renderConsGroup(){
  const t = CONS_ORDER[consGroup];
  const info = consData.types[t] || {};
  const qs = consData.questions.filter(q=>q.type===t);
  $('cons-progress').innerHTML = CONS_ORDER.map((x,i)=>
    `<span class="cp-dot ${i<consGroup?'done':i===consGroup?'cur':''}">${i+1}</span>`).join('');
  $('cons-group-title').textContent = `${info.name||t}`;
  $('cons-questions').innerHTML = qs.map(q=>
    `<div class="cons-q">
       <div class="cons-q-text">${q.text}</div>
       <div class="cons-opts">
         ${consData.options.map(o=>
           `<span class="cons-opt ${consAnswers[q.qid]===o.value?'on':''}" onclick="pickCons('${q.qid}',${o.value})">${o.label}</span>`).join('')}
       </div>
     </div>`).join('');
  $('cons-prev').style.visibility = consGroup===0 ? 'hidden' : 'visible';
  $('cons-next').textContent = consGroup===CONS_ORDER.length-1 ? '提交答卷 ✓' : '下一组 →';
}
function pickCons(qid, val){
  consAnswers[qid] = val;
  renderConsGroup();
}
function consPrev(){ if(consGroup>0){ consGroup--; renderConsGroup(); } }
async function consNext(){
  const t = CONS_ORDER[consGroup];
  const qs = consData.questions.filter(q=>q.type===t);
  const answered = qs.filter(q=>consAnswers[q.qid]).length;
  if(answered < qs.length){ toast('这组还有题没答完'); return; }
  if(consGroup < CONS_ORDER.length-1){
    consGroup++; renderConsGroup();
    $('cons-questions').scrollTop = 0;
  }else{
    await submitCons();
  }
}
async function submitCons(){
  const btn = $('cons-next');
  btn.textContent = '判定中…'; btn.style.pointerEvents='none';
  try{
    const r = await api('/api/constitution/submit', {method:'POST', body: JSON.stringify({answers: consAnswers})});
    renderConsResult(r);
  }catch(e){
    toast('提交失败，重试一下');
    btn.textContent = '提交答卷 ✓'; btn.style.pointerEvents='';
  }
}
function renderConsResult(r){
  myType = r.main_type;               // 立即生效：角标马上出现
  const info = (r.types||{})[r.main_type] || {};
  const p = r.profile || {};
  const scoreRows = CONS_ORDER.map(t=>{
    const s = (r.scores||{})[t] || 0;
    const nm = (r.types||{})[t]?.name || t;
    const hot = s>=40, mid = s>=30;
    return `<div class="score-row">
      <span class="s-name">${(r.types||{})[t]?.icon||''} ${nm}</span>
      <div class="s-bar"><div class="s-fill ${hot?'hot':mid?'mid':''}" style="width:${s}%"></div></div>
      <span class="s-val">${s}</span>
    </div>`;
  }).join('');
  const subHtml = (r.sub_types||[]).map(s=>
    `<span class="sub-chip">${(r.types||{})[s.type]?.icon||''} ${(r.types||{})[s.type]?.name||s.type}（${s.level}）</span>`).join('');
  $('cons-quiz').style.display = 'none';
  const box = $('cons-result');
  box.style.display = 'block';
  box.innerHTML = `
    <div class="cons-main">
      <div class="cons-main-icon">${info.icon||'🌿'}</div>
      <div class="cons-main-name serif">${info.name||r.main_type} <small>${r.main_level}</small></div>
      <div class="cons-main-sum">${p.summary||''}</div>
    </div>
    ${subHtml ? `<div class="cons-subs">兼有：${subHtml}</div>` : ''}
    <div class="cons-detail">
      <div class="cd-row"><b>典型表现</b><span>${p.traits||''}</span></div>
      <div class="cd-row"><b>调养方向</b><span>${p.advice||''}</span></div>
      <div class="cd-row"><b>宜吃</b><span>${p.foods||''}</span></div>
      <div class="cd-row"><b>忌口</b><span>${p.avoid_foods||''}</span></div>
      <div class="cd-row"><b>用药方向</b><span>${p.herb_tip||''}</span></div>
    </div>
    <div class="cons-scores"><div class="cs-title">九型得分</div>${scoreRows}</div>
    <div class="cons-disclaimer">${r.disclaimer||''}</div>
    <div class="btn-row">
      <button class="btn grey" onclick="openCons()">重测一次</button>
      <button class="btn gold" onclick="closeCons(); go('shelf'); pickShelfType('patent')">看看适合我的中成药 →</button>
    </div>`;
  loadConsCard();
}

/* 我的页体质卡片 */
async function loadConsCard(){
  try{
    const r = await api('/api/constitution/result');
    if(r.ok){
      myType = r.main_type;
      const info = (r.types||{})[r.main_type] || {};
      $('cons-card-desc').innerHTML = `${info.icon||''} <b>${info.name||''}</b>（${r.main_level}）· 测于 ${r.time}<br>${(r.profile||{}).summary||''}`;
      $('cons-card-btn').textContent = '查看';
    }
  }catch(e){}
}

/* ---------------- 配伍实验室 ---------------- */
async function openPair(){
  $('pair-overlay').classList.add('show');
  $('pair-result').innerHTML = '';
  const dl = $('pair-list');
  if(!dl.dataset.loaded){
    try{
      const r = await api('/api/pair/inputs');
      dl.innerHTML = r.items.map(n=>`<option value="${n}">`).join('');
      dl.dataset.loaded = '1';
    }catch(e){}
  }
}
function closePair(){ $('pair-overlay').classList.remove('show'); }

async function queryPair(){
  const a = $('pair-a').value.trim(), b = $('pair-b').value.trim();
  if(!a || !b){ toast('请填两个药名'); return; }
  const box = $('pair-result');
  box.innerHTML = '<div class="pair-loading">查询中…</div>';
  try{
    const r = await api(`/api/pair?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    if(r.danger){
      box.innerHTML = `
        <div class="pair-card danger">
          <div class="pr-head">🚫 禁止配伍 · ${r.source}</div>
          <div class="pr-title">${a} ＋ ${b}</div>
          <div class="pr-note">${r.effect}</div>
          <div class="pr-sub">「十八反」「十九畏」是历代公认的配伍红线，临床禁止同用。</div>
        </div>`;
    }else if(r.found){
      const good = (r.relation==='相须' || r.relation==='相使');
      box.innerHTML = `
        <div class="pair-card ${good?'good':'mid'}">
          <div class="pr-head">${good?'🤝 经典配伍':'⚠️ 需注意'} · ${r.relation}</div>
          <div class="pr-title">${a} ＋ ${b}</div>
          <div class="pr-note">${r.effect}${r.formula?`（出自 <b>${r.formula}</b>）`:''}</div>
          <div class="pr-sub">${r.note||''}</div>
        </div>`;
    }else{
      box.innerHTML = `
        <div class="pair-card none">
          <div class="pr-head">📖 经典配伍表未收录</div>
          <div class="pr-title">${a} ＋ ${b}</div>
          <div class="pr-sub">${r.hint||''}</div>
          <button class="btn gold pair-ask" onclick="pairAskAI()">✦ 让 AI 助教分析</button>
        </div>`;
    }
  }catch(e){
    box.innerHTML = `<div class="pair-card none"><div class="pr-sub">查询失败：${e.message||'网络问题'}</div></div>`;
  }
}
function pairAskAI(){
  const a = $('pair-a').value.trim(), b = $('pair-b').value.trim();
  closePair();
  openAsk(0);
  setTimeout(()=>{
    $('chat-input').value = `请从中医配伍（七情）角度分析：${a}和${b}一起用是什么关系？适合什么情况？`;
    submitAsk();
  }, 250);
}

/* ---------------- 启动 ---------------- */
const d = new Date();
const WEEK = ['日','一','二','三','四','五','六'];
$('today-date').textContent = `${d.getFullYear()} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日 · 星期${WEEK[d.getDay()]}`;
loadToday();
loadConsCard();   // 拉体质结果：有则全站显示宜忌角标

/* Service Worker（PWA 离线缓存） */
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
