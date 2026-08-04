const { SET_IDS, SET_CARD_IDS, cardLabel, cardIsRed, setLabel, shortSetTok } = window.FishCards;
const socket = io();

/* ---------- identity ---------- */
function uuid(){ return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
  const r = Math.random()*16|0, v = c==='x'?r:(r&0x3|0x8); return v.toString(16);
}); }
let playerId = localStorage.getItem('fish_playerId');
if(!playerId){ playerId = uuid(); localStorage.setItem('fish_playerId', playerId); }
let myName = localStorage.getItem('fish_name') || '';

/* ---------- app state ---------- */
const S = {
  screen:'home', code:null, mySeat:null,
  room:null,      // lobby state {code, phase, hostSeat, seats:[...]}
  pub:null,       // public game state {seats,turn,log,scores,discard,phase,winner,pendingPass,handCounts}
  myHand:[],
  ui:{ askSet:'', declareOpen:false, declareSet:null, declareAssign:{}, joinCode:'', error:'' }
};

function render(){
  const app = document.getElementById('app');
  if(S.screen==='home') app.innerHTML = renderHome();
  else if(S.screen==='lobby') app.innerHTML = renderLobby();
  else if(S.screen==='game') app.innerHTML = renderGame();
  attachHandlers();
}

/* ================= HOME ================= */
function renderHome(){
  const lastCode = localStorage.getItem('fish_lastCode');
  return `
  <div class="home-wrap">
    <div class="home-title">F<em>I</em>SH</div>
    <div class="home-sub">nine sets \u00b7 two teams \u00b7 one memory game</div>
    <div class="ledger">${SET_IDS.map(()=>`<div class="tok"></div>`).join('')}</div>
    <div class="name-row">
      <input id="nameInput" placeholder="Your name" maxlength="16" value="${myName.replace(/"/g,'')}">
    </div>
    ${S.ui.error ? `<div class="banner" style="margin-bottom:16px;max-width:420px;">${S.ui.error}</div>` : ''}
    <div class="home-actions">
      <button class="btn-primary" id="btnBots">Play vs Bots</button>
      <button class="btn-secondary" id="btnCreate">Create Room</button>
    </div>
    <div class="join-row">
      <input id="joinCode" placeholder="CODE" maxlength="5" value="${S.ui.joinCode}">
      <button class="btn-secondary" id="btnJoin">Join Room</button>
    </div>
    ${lastCode ? `<div style="margin-top:14px;"><button class="link-btn" id="btnRejoin">Rejoin room ${lastCode}</button></div>` : ''}
    <div class="home-note">Real-time rooms, powered by a small server \u2014 hands are private and kept server-side, so this one's safe to play for keeps. Share a room code with friends to play together from anywhere.</div>
  </div>`;
}

function ensureName(){
  const input = document.getElementById('nameInput');
  if(input && input.value.trim()) myName = input.value.trim();
  if(!myName) myName = 'Player' + Math.floor(Math.random()*90+10);
  localStorage.setItem('fish_name', myName);
}

function attachHomeHandlers(){
  const joinCode = document.getElementById('joinCode');
  if(joinCode) joinCode.addEventListener('input', e=>{ S.ui.joinCode = e.target.value.toUpperCase(); });
  const btnBots = document.getElementById('btnBots');
  if(btnBots) btnBots.addEventListener('click', startBotsGame);
  const btnCreate = document.getElementById('btnCreate');
  if(btnCreate) btnCreate.addEventListener('click', createRoom);
  const btnJoin = document.getElementById('btnJoin');
  if(btnJoin) btnJoin.addEventListener('click', joinRoom);
  const btnRejoin = document.getElementById('btnRejoin');
  if(btnRejoin) btnRejoin.addEventListener('click', ()=>{
    S.ui.joinCode = localStorage.getItem('fish_lastCode') || '';
    joinRoom();
  });
}

function createRoom(){
  ensureName();
  socket.emit('create_room', { name: myName, playerId }, (res)=>{
    if(!res.ok){ S.ui.error = res.error || 'Could not create room.'; render(); return; }
    S.code = res.code; S.mySeat = res.seat;
    localStorage.setItem('fish_lastCode', res.code);
    S.screen = 'lobby'; S.ui.error=''; render();
  });
}

function joinRoom(){
  ensureName();
  const code = (S.ui.joinCode||'').trim().toUpperCase();
  if(!code){ S.ui.error = 'Enter a room code.'; render(); return; }
  socket.emit('join_room', { code, name: myName, playerId }, (res)=>{
    if(!res.ok){ S.ui.error = res.error || 'Could not join room.'; render(); return; }
    S.code = res.code; S.mySeat = res.seat;
    localStorage.setItem('fish_lastCode', res.code);
    S.ui.error='';
    S.screen = (res.phase==='playing' || res.phase==='ended') ? 'game' : 'lobby';
    render();
  });
}

function startBotsGame(){
  ensureName();
  socket.emit('create_room', { name: myName, playerId }, (res)=>{
    if(!res.ok){ S.ui.error = res.error || 'Could not start game.'; render(); return; }
    S.code = res.code; S.mySeat = res.seat;
    localStorage.setItem('fish_lastCode', res.code);
    const botNames = ['Bea','Casper','Dot','Ezra','Fig'];
    for(let seat=1; seat<6; seat++){
      socket.emit('fill_bot', { code: res.code, seat, botName: botNames[seat-1] });
    }
    setTimeout(()=> socket.emit('start_game', { code: res.code }), 150);
  });
}

/* ================= LOBBY ================= */
function renderLobby(){
  const room = S.room;
  if(!room) return '<div class="home-wrap"><h2>Loading room...</h2></div>';
  const isHost = room.hostSeat === S.mySeat;
  const seatsHtml = room.seats.map(s=>{
    const filled = s.present;
    const label = s.isBot ? (s.name||'Bot')+' \ud83e\udd16' : (s.present ? s.name + (s.connected?'':' (offline)') : 'Waiting for player...');
    const teamClass = s.team==='A' ? 'team-a' : 'team-b';
    let action = '';
    if(isHost && !s.present && s.seat!==room.hostSeat){
      action = `<button class="btn-small" data-fillbot="${s.seat}">Fill with bot</button>`;
    } else if(isHost && s.isBot){
      action = `<button class="btn-small" data-clearseat="${s.seat}">Clear</button>`;
    }
    return `<div class="seat-card ${teamClass} ${filled?'':'empty'}">
      <span><span class="seat-dot"></span>Seat ${s.seat+1} \u2014 ${label}</span>
      ${action}
    </div>`;
  }).join('');
  const allFilled = room.seats.every(s=>s.present);
  return `
  <div class="panel" style="max-width:640px;margin:40px auto;">
    <h2 style="margin-bottom:6px;">Lobby</h2>
    <div class="small-dim" style="margin-bottom:14px;">Share this code with friends</div>
    <div class="lobby-code mono">${room.code}</div>
    <div class="seat-grid">${seatsHtml}</div>
    ${isHost ? `<div style="margin-top:22px;display:flex;gap:10px;">
        <button class="btn-primary" id="btnStart" ${allFilled?'':'disabled'}>Start Game</button>
        <span class="small-dim" style="align-self:center;">${allFilled?'':'Fill every seat (or wait for players) to start'}</span>
      </div>`
      : `<div style="margin-top:22px;" class="small-dim">Waiting for the host to start the game...</div>`}
    <div style="margin-top:20px;"><button class="link-btn" id="btnLeaveLobby">Leave</button></div>
  </div>`;
}

function attachLobbyHandlers(){
  document.querySelectorAll('[data-fillbot]').forEach(b=>b.addEventListener('click', e=>{
    const seat = Number(e.target.dataset.fillbot);
    const botNames=['Bea','Casper','Dot','Ezra','Fig','Gale'];
    socket.emit('fill_bot', { code: S.code, seat, botName: botNames[seat] || ('Bot '+seat) });
  }));
  document.querySelectorAll('[data-clearseat]').forEach(b=>b.addEventListener('click', e=>{
    socket.emit('clear_seat', { code: S.code, seat: Number(e.target.dataset.clearseat) });
  }));
  const btnStart = document.getElementById('btnStart');
  if(btnStart) btnStart.addEventListener('click', ()=> socket.emit('start_game', { code: S.code }));
  const btnLeave = document.getElementById('btnLeaveLobby');
  if(btnLeave) btnLeave.addEventListener('click', goHome);
}

function goHome(){
  if(S.code) socket.emit('leave_room', { code: S.code });
  localStorage.removeItem('fish_lastCode');
  S.screen='home'; S.code=null; S.mySeat=null; S.room=null; S.pub=null; S.myHand=[];
  render();
}

/* ================= GAME ================= */
function opponentsOf(seat){ const t = S.pub.seats[seat].team; return S.pub.seats.filter(s=>s.team!==t).map(s=>s.seat); }
function teammatesOf(seat){ const t = S.pub.seats[seat].team; return S.pub.seats.filter(s=>s.team===t && s.seat!==seat).map(s=>s.seat); }

function renderGame(){
  const g = S.pub;
  if(!g) return '<div class="home-wrap"><h2>Loading game...</h2></div>';
  if(g.phase==='ended') return renderEnd(g);

  const mySeat = S.mySeat;
  const myHand = S.myHand || [];
  const myTurn = g.turn===mySeat;

  const sidebar = g.seats.map(s=>{
    const active = g.turn===s.seat;
    const teamClass = s.team==='A'?'chip-a':'chip-b';
    return `<div class="player-row ${active?'active-turn':''}">
      <span class="pname"><span class="seat-dot ${teamClass}"></span>${s.name}${s.isBot?' \ud83e\udd16':''}${s.seat===mySeat?' (you)':''}${(!s.isBot && !s.connected)?' \u2014 offline':''}</span>
      <span class="pcount">${g.handCounts[s.seat]} cards</span>
    </div>`;
  }).join('');

  const ledger = SET_IDS.map(setId=>{
    const won = g.discard[setId];
    const cls = won==='A'?'won-a':(won==='B'?'won-b':'');
    return `<div class="ledger-tok ${cls}" title="${setLabel(setId)}">${shortSetTok(setId)}</div>`;
  }).join('');

  const logHtml = g.log.slice(-2).reverse().map(ev=>logLine(ev, g)).join('');

  const counts = {A:0,B:0};
  g.seats.forEach(s=> counts[s.team]+=g.handCounts[s.seat]);

  let banner = '';
  if(g.pendingPass && g.turn===mySeat){
    banner = `<div class="banner">You're out of cards \u2014 pass the turn to a teammate.</div>`;
  } else if(g.pendingPass){
    banner = `<div class="banner">${g.seats[g.turn].name} is out of cards and needs to pass to a teammate...</div>`;
  } else if(myTurn){
    banner = `<div class="banner">Your turn \u2014 ask an opponent for a card.</div>`;
  } else if(g.seats[g.turn].isBot){
    banner = `<div class="banner">${g.seats[g.turn].name} is thinking...</div>`;
  } else {
    banner = `<div class="banner">Waiting on ${g.seats[g.turn].name}...</div>`;
  }

  const oppOptions = opponentsOf(mySeat).filter(o=>g.handCounts[o]>0)
    .map(o=>`<option value="${o}">${g.seats[o].name}</option>`).join('');
  const heldSets = [...new Set(myHand.map(c=>setOfCard(c)))].filter(s=>!g.discard[s]);
  const setOptions = heldSets.map(s=>`<option value="${s}" ${s===chosenSet?'selected':''}>${setLabel(s)}</option>`).join('');
  const chosenSet = S.ui.askSet && heldSets.includes(S.ui.askSet) ? S.ui.askSet : heldSets[0];
  const cardOptions = chosenSet ? SET_CARD_IDS[chosenSet].filter(c=>!myHand.includes(c)).map(c=>`<option value="${c}">${cardLabel(c)}</option>`).join('') : '';

  const passOptions = g.pendingPass && g.turn===mySeat ? teammatesOf(mySeat).filter(m=>g.handCounts[m]>0).map(m=>`<option value="${m}">${g.seats[m].name}</option>`).join('') : '';

  return `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
    <h2 style="font-size:22px;">Fish <span class="mono" style="font-size:14px;color:var(--gold-bright);">${S.code}</span></h2>
    <button class="link-btn" id="btnLeaveGame">Leave game</button>
  </div>
  <div class="ledger-strip">${ledger}</div>
  <div class="score-strip" style="justify-content:center;margin-bottom:18px;">
    <span><span class="seat-dot chip-a"></span>Team A: ${g.scores.A.length} sets \u00b7 ${counts.A} cards</span>
    <span><span class="seat-dot chip-b"></span>Team B: ${g.scores.B.length} sets \u00b7 ${counts.B} cards</span>
  </div>
  <div class="game-grid">
    <div class="sidebar">${sidebar}</div>
    <div class="board-main">
      ${banner}
      <div class="log">${logHtml}</div>
      <div class="controls">
        ${g.seats.some(s=>s.isBot) ? `
        <div class="row" style="align-items:center;justify-content:space-between;">
          <label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="autoplayToggle" ${g.autoPlay?'checked':''}/> Auto-play bots
          </label>
          ${!g.autoPlay && g.seats[g.turn].isBot ? `<button class="btn-small" id="btnBotStep">Next bot move \u2192</button>` : ''}
        </div>` : ''}
        ${g.pendingPass && g.turn===mySeat ? `
          <h3>Pass your turn</h3>
          <div class="row">
            <select id="passTarget">${passOptions}</select>
            <button class="btn-primary" id="btnPass">Pass</button>
          </div>
        ` : myTurn ? `
          <h3>Ask for a card</h3>
          <div class="row">
            <select id="askSet">${setOptions}</select>
            <select id="askCard">${cardOptions}</select>
            <select id="askTarget">${oppOptions}</select>
            <button class="btn-primary" id="btnAsk" ${heldSets.length===0?'disabled':''}>Ask</button>
          </div>
        ` : `<div class="small-dim">You can still declare a set below at any time.</div>`}
        <div class="actions-bottom">
          <button class="btn-secondary" id="btnDeclare">Declare a Set</button>
        </div>
      </div>
      <div class="hand-wrap">
        <div class="hand-label">Your hand \u2014 ${g.seats[mySeat].name}</div>
        <div class="hand">${myHand.map(c=>`<div class="card ${cardIsRed(c)?'red':''}">${cardLabel(c)}</div>`).join('') || '<span class="small-dim">No cards</span>'}</div>
      </div>
    </div>
  </div>
  ${S.ui.declareOpen ? renderDeclareModal(g, mySeat) : ''}
  `;
}

function cardChip(cardId){
  return `<span class="card-chip ${cardIsRed(cardId)?'suit-red':'suit-black'}">${cardLabel(cardId)}</span>`;
}

function setOfCard(cardId){
  const c = window.FishCards.CARD_BY_ID[cardId];
  return c.setId;
}

function logLine(ev, g){
  const nameOf = s => (g.seats[s] ? g.seats[s].name : '?');
  if(ev.type==='system') return `<div class="log-entry">${ev.text}</div>`;
  if(ev.type==='ask'){
    const cls = ev.result==='yes' ? '' : 'fail';
    const txt = ev.result==='yes'
      ? `${nameOf(ev.asker)} asked ${nameOf(ev.target)} for ${cardChip(ev.cardId)} \u2014 got it!`
      : `${nameOf(ev.asker)} asked ${nameOf(ev.target)} for ${cardChip(ev.cardId)} \u2014 no.`;
    return `<div class="log-entry ${cls}">${txt}</div>`;
  }
  if(ev.type==='pass') return `<div class="log-entry">${nameOf(ev.from)} passed the turn to ${nameOf(ev.to)}.</div>`;
  if(ev.type==='declare'){
    const cls = ev.success ? 'win' : 'fail';
    const txt = `${nameOf(ev.by)} declared ${setLabel(ev.setId)} \u2014 ${ev.success?'correct! Team '+ev.winningTeam+' wins the set.':'misdeclared! Team '+ev.winningTeam+' wins the set.'}`;
    return `<div class="log-entry ${cls}">${txt}</div>`;
  }
  return '';
}

function renderDeclareModal(g, mySeat){
  const mates = [mySeat, ...teammatesOf(mySeat)];
  const options = SET_IDS.filter(s=>!g.discard[s]);
  const chosen = S.ui.declareSet && options.includes(S.ui.declareSet) ? S.ui.declareSet : options[0];
  const rows = chosen ? SET_CARD_IDS[chosen].map(cid=>{
    const cur = S.ui.declareAssign[cid];
    const inMyHand = S.myHand.includes(cid);
    const val = inMyHand ? mySeat : (cur!==undefined?cur:'');
    return `<div class="assign-row">
      <span>${cardLabel(cid)}</span>
      <select data-assign="${cid}" ${inMyHand?'disabled':''}>
        <option value="">\u2014 choose \u2014</option>
        ${mates.map(m=>`<option value="${m}" ${String(val)===String(m)?'selected':''}>${g.seats[m].name}${m===mySeat?' (you)':''}</option>`).join('')}
      </select>
    </div>`;
  }).join('') : '<div class="small-dim">No active sets left.</div>';

  return `
  <div class="modal-overlay" id="declareOverlay">
    <div class="modal">
      <h3 style="margin-bottom:14px;">Declare a Set</h3>
      <div class="row">
        <select id="declareSetSelect">${options.map(s=>`<option value="${s}" ${s===chosen?'selected':''}>${setLabel(s)}</option>`).join('')}</select>
      </div>
      <div>${rows}</div>
      <div style="display:flex;gap:10px;margin-top:18px;">
        <button class="btn-primary" id="btnConfirmDeclare">Declare</button>
        <button class="btn-secondary" id="btnCancelDeclare">Cancel</button>
      </div>
      <div class="small-dim" style="margin-top:10px;">Assign every card to yourself or a teammate. If any card is actually held by the opposing team, the declare fails and they win the set.</div>
    </div>
  </div>`;
}

function renderEnd(g){
  const winnerName = g.winner==='A' ? 'Team A' : 'Team B';
  return `
  <div class="end-screen">
    <h1 style="font-size:44px;color:var(--gold-bright);">${winnerName} wins!</h1>
    <p class="small-dim" style="margin:14px 0 26px;">Final score \u2014 Team A: ${g.scores.A.length} sets \u00b7 Team B: ${g.scores.B.length} sets</p>
    <div class="ledger-strip" style="justify-content:center;">${SET_IDS.map(s=>{
      const won=g.discard[s]; const cls= won==='A'?'won-a':(won==='B'?'won-b':'');
      return `<div class="ledger-tok ${cls}">${shortSetTok(s)}</div>`;
    }).join('')}</div>
    <button class="btn-primary" style="margin-top:30px;" id="btnPlayAgain">Back to Home</button>
  </div>`;
}

function attachGameHandlers(){
  const autoplayToggle = document.getElementById('autoplayToggle');
  if(autoplayToggle) autoplayToggle.addEventListener('change', e=>{
    socket.emit('set_autoplay', { code: S.code, auto: e.target.checked });
  });
  const btnBotStep = document.getElementById('btnBotStep');
  if(btnBotStep) btnBotStep.addEventListener('click', ()=>{
    socket.emit('bot_step', { code: S.code });
  });

  const btnLeave = document.getElementById('btnLeaveGame');
  if(btnLeave) btnLeave.addEventListener('click', goHome);
  const btnPlayAgain = document.getElementById('btnPlayAgain');
  if(btnPlayAgain) btnPlayAgain.addEventListener('click', goHome);

  const askSet = document.getElementById('askSet');
  if(askSet) askSet.addEventListener('change', e=>{ S.ui.askSet=e.target.value; render(); });
  const btnAsk = document.getElementById('btnAsk');
  if(btnAsk) btnAsk.addEventListener('click', ()=>{
    const cardId = document.getElementById('askCard').value;
    const target = Number(document.getElementById('askTarget').value);
    if(!cardId || isNaN(target)) return;
    socket.emit('ask', { code: S.code, target, cardId });
  });

  const btnPass = document.getElementById('btnPass');
  if(btnPass) btnPass.addEventListener('click', ()=>{
    const to = Number(document.getElementById('passTarget').value);
    if(isNaN(to)) return;
    socket.emit('pass', { code: S.code, to });
  });

  const btnDeclare = document.getElementById('btnDeclare');
  if(btnDeclare) btnDeclare.addEventListener('click', ()=>{ S.ui.declareOpen=true; S.ui.declareAssign={}; render(); });
  const btnCancelDeclare = document.getElementById('btnCancelDeclare');
  if(btnCancelDeclare) btnCancelDeclare.addEventListener('click', ()=>{ S.ui.declareOpen=false; render(); });
  const declareSetSelect = document.getElementById('declareSetSelect');
  if(declareSetSelect) declareSetSelect.addEventListener('change', e=>{ S.ui.declareSet=e.target.value; S.ui.declareAssign={}; render(); });
  document.querySelectorAll('[data-assign]').forEach(sel=>sel.addEventListener('change', e=>{
    S.ui.declareAssign[e.target.dataset.assign] = e.target.value;
  }));
  const btnConfirmDeclare = document.getElementById('btnConfirmDeclare');
  if(btnConfirmDeclare) btnConfirmDeclare.addEventListener('click', ()=>{
    const setId = document.getElementById('declareSetSelect').value;
    const assignment = {};
    for(const cid of SET_CARD_IDS[setId]){
      if(S.myHand.includes(cid)) assignment[cid]=S.mySeat;
      else {
        const v = S.ui.declareAssign[cid];
        if(v!==undefined && v!=='') assignment[cid]=Number(v);
      }
    }
    S.ui.declareOpen=false;
    socket.emit('declare', { code: S.code, setId, assignment });
    render();
  });
}

function attachHandlers(){
  if(S.screen==='home') attachHomeHandlers();
  else if(S.screen==='lobby') attachLobbyHandlers();
  else if(S.screen==='game') attachGameHandlers();
}

/* ================= SOCKET EVENTS ================= */
socket.on('room_update', room=>{
  S.room = room;
  if(S.screen==='home') S.screen='lobby';
  if(room.phase==='playing' || room.phase==='ended'){
    // handled by game_update transition below
  }
  render();
});

socket.on('game_update', pub=>{
  S.pub = pub;
  S.screen = 'game';
  render();
});

socket.on('your_hand', ({hand})=>{
  S.myHand = hand;
  if(S.screen==='game') render();
});

render();
