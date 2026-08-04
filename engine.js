/* ============================= CARD / SET DEFINITIONS ============================= */
const SUITS = ['S','H','D','C'];
const SUIT_SYMBOL = {S:'\u2660',H:'\u2665',D:'\u2666',C:'\u2663'};
const SUIT_NAME = {S:'Spades',H:'Hearts',D:'Diamonds',C:'Clubs'};
const RED_SUITS = new Set(['H','D']);
const LOW_RANKS = ['2','3','4','5','6','7'];
const HIGH_RANKS = ['9','10','J','Q','K','A'];

function buildDeck(){
  const deck = [];
  for(const suit of SUITS){
    for(const rank of LOW_RANKS) deck.push({id:rank+suit, rank, suit, setId:'low-'+suit});
    for(const rank of HIGH_RANKS) deck.push({id:rank+suit, rank, suit, setId:'high-'+suit});
    deck.push({id:'8'+suit, rank:'8', suit, setId:'mid'});
  }
  deck.push({id:'JOKER_R', rank:'JOKER', suit:'R', setId:'mid'});
  deck.push({id:'JOKER_B', rank:'JOKER', suit:'B', setId:'mid'});
  return deck;
}
const DECK = buildDeck();
const CARD_BY_ID = Object.fromEntries(DECK.map(c=>[c.id,c]));

const SET_IDS = [
  'low-S','low-H','low-D','low-C',
  'high-S','high-H','high-D','high-C',
  'mid'
];
function setLabel(setId){
  if(setId==='mid') return 'Eights & Jokers';
  const [tier,suit] = setId.split('-');
  return (tier==='low'?'Low ':'High ') + SUIT_NAME[suit] + (tier==='low'?' (2\u20137)':' (9\u2013A)');
}
function setCards(setId){ return DECK.filter(c=>c.setId===setId).map(c=>c.id); }
const SET_CARD_IDS = Object.fromEntries(SET_IDS.map(s=>[s, setCards(s)]));

function cardLabel(id){
  const c = CARD_BY_ID[id];
  if(c.rank==='JOKER') return (c.suit==='R'?'Red':'Black')+' Joker';
  return c.rank + SUIT_SYMBOL[c.suit];
}
function cardIsRed(id){
  const c = CARD_BY_ID[id];
  if(c.rank==='JOKER') return c.suit==='R';
  return RED_SUITS.has(c.suit);
}
function shortSetTok(setId){
  if(setId==='mid') return '8s+J';
  const [tier,suit]=setId.split('-');
  return (tier==='low'?'Lo':'Hi')+SUIT_SYMBOL[suit];
}

/* seed-free shuffle (local use only) */
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

/* ============================= GAME ENGINE (pure-ish, mutates game obj) ============================= */
// game = { seats:[{seat,name,isBot,team}], hands:{0:[ids],...}, turn, log:[], scores:{A:[],B:[]}, discard:{setId:'A'|'B'}, phase, winner, pendingPass }

function teamOf(seat){ return seat%2===0 ? 'A':'B'; }
function teammates(seat){ const t=teamOf(seat); const res=[]; for(let s=0;s<6;s++) if(s!==seat && teamOf(s)===t) res.push(s); return res; }
function opponents(seat){ const t=teamOf(seat); const res=[]; for(let s=0;s<6;s++) if(teamOf(s)!==t) res.push(s); return res; }

function newGame(seatMeta){
  const deck = shuffle(DECK.map(c=>c.id));
  const hands = {};
  for(let s=0;s<6;s++) hands[s]=[];
  deck.forEach((cid,i)=>{ hands[i%6].push(cid); });
  for(let s=0;s<6;s++) hands[s].sort(cardSortKey);
  const pub = {known:{}, possible:{}, flip:{}};
  for(const c of DECK) pub.possible[c.id] = new Set([0,1,2,3,4,5]);
  return {
    seats: seatMeta, hands, turn:0,
    log:[{type:'system', text:'Cards dealt. '+seatMeta[0].name+' goes first.'}],
    scores:{A:[],B:[]}, discard:{}, phase:'playing', winner:null, pendingPass:false,
    actionCount:0, _pub: pub
  };
}

/* keep the public (viewer-independent) belief cache in sync with hand sizes hitting zero */
function refreshPubForEmptyHands(game){
  for(let s=0;s<6;s++){
    if(game.hands[s].length>0) continue;
    for(const cid in game._pub.possible){
      const poss = game._pub.possible[cid];
      if(poss.delete(s) && poss.size===1 && game._pub.known[cid]===undefined){
        game._pub.known[cid] = [...poss][0];
      }
    }
  }
}
function cardSortKey(a,b){
  const ca=CARD_BY_ID[a], cb=CARD_BY_ID[b];
  if(ca.setId!==cb.setId) return SET_IDS.indexOf(ca.setId)-SET_IDS.indexOf(cb.setId);
  return DECK.findIndex(c=>c.id===a) - DECK.findIndex(c=>c.id===b);
}

function activeSets(game){ return SET_IDS.filter(s=>!game.discard[s]); }

function legalAskTargets(game, seat){
  // returns list of {setId, cardId, target}
  const out=[];
  const hand = game.hands[seat];
  const heldSets = new Set(hand.map(c=>CARD_BY_ID[c].setId));
  const oppList = opponents(seat).filter(o=>game.hands[o].length>0);
  for(const setId of heldSets){
    if(game.discard[setId]) continue;
    for(const cid of SET_CARD_IDS[setId]){
      if(hand.includes(cid)) continue;
      for(const t of oppList) out.push({setId, cardId:cid, target:t});
    }
  }
  return out;
}

function applyAsk(game, asker, target, cardId){
  game.actionCount = (game.actionCount||0)+1;
  const has = game.hands[target].includes(cardId);
  if(has){
    game.hands[target] = game.hands[target].filter(c=>c!==cardId);
    game.hands[asker].push(cardId);
    game.hands[asker].sort(cardSortKey);
    game.log.push({type:'ask', asker, target, cardId, result:'yes'});
    game._pub.known[cardId] = asker;
    delete game._pub.possible[cardId];
    game._pub.flip[cardId] = (game._pub.flip[cardId]||0) + 1;
  } else {
    game.log.push({type:'ask', asker, target, cardId, result:'no'});
    game.turn = target;
    const poss = game._pub.possible[cardId];
    if(poss){
      poss.delete(target);
      if(poss.size===1 && game._pub.known[cardId]===undefined) game._pub.known[cardId]=[...poss][0];
    }
  }
  refreshPubForEmptyHands(game);
  checkAutoPass(game);
  return has;
}

function checkAutoPass(game){
  const cur = game.turn;
  if(game.hands[cur].length>0) return;
  const mates = teammates(cur).filter(m=>game.hands[m].length>0);
  if(mates.length>0){
    game.pendingPass = true; // UI/bot must choose who to pass to
  } else {
    game.pendingPass = false; // whole team empty-handed; handled by declare-phase banner
  }
}

function applyPass(game, from, to){
  game.log.push({type:'pass', from, to});
  game.turn = to;
  game.pendingPass = false;
}

// assignment: {cardId: seat} must cover all 6 cards of the set, seat must be declarer or a teammate
function applyDeclare(game, byseat, setId, assignment){
  const team = teamOf(byseat);
  const mates = new Set([byseat, ...teammates(byseat)]);
  let success = true;
  for(const cid of SET_CARD_IDS[setId]){
    const claimedSeat = assignment[cid];
    if(claimedSeat===undefined || !mates.has(Number(claimedSeat))){ success=false; continue; }
    const trueSeat = seatHolding(game, cid);
    if(trueSeat !== Number(claimedSeat)) success=false;
  }
  const winningTeam = success ? team : (team==='A'?'B':'A');
  game.discard[setId] = winningTeam;
  game.scores[winningTeam].push(setId);
  // remove set cards from all hands
  for(const cid of SET_CARD_IDS[setId]){
    for(let s=0;s<6;s++) game.hands[s]=game.hands[s].filter(c=>c!==cid);
  }
  game.log.push({type:'declare', by:byseat, team, setId, assignment, success, winningTeam});
  for(const cid of SET_CARD_IDS[setId]){ game._pub.known[cid]='discarded'; delete game._pub.possible[cid]; }
  refreshPubForEmptyHands(game);
  checkAutoPass(game);
  if(game.scores[winningTeam].length>=5){
    game.phase='ended'; game.winner=winningTeam;
  }
  return {success, winningTeam};
}

/* Safety valve: if a game runs unreasonably long (only possible in edge-case
   all-bot standoffs), force-resolve remaining sets by majority holder so the
   game always terminates rather than running forever. */
function forceResolveGame(game){
  for(const setId of activeSets(game)){
    const counts = {A:0,B:0};
    for(const cid of SET_CARD_IDS[setId]){
      const holder = seatHolding(game, cid);
      if(holder!==null) counts[teamOf(holder)]++;
    }
    const winningTeam = counts.A===counts.B ? (Math.random()<0.5?'A':'B') : (counts.A>counts.B?'A':'B');
    game.discard[setId]=winningTeam;
    game.scores[winningTeam].push(setId);
    for(const cid of SET_CARD_IDS[setId]) for(let s=0;s<6;s++) game.hands[s]=game.hands[s].filter(c=>c!==cid);
    game.log.push({type:'system', text:'The '+setLabel(setId)+' set was too contested to resolve normally, so it went to Team '+winningTeam+' by majority hold.'});
  }
  game.phase='ended';
  game.winner = game.scores.A.length>=game.scores.B.length ? 'A':'B';
}

function seatHolding(game, cardId){
  for(let s=0;s<6;s++) if(game.hands[s].includes(cardId)) return s;
  return null;
}

function bothTeamsCardCounts(game){
  const c={A:0,B:0};
  for(let s=0;s<6;s++) c[teamOf(s)] += game.hands[s].length;
  return c;
}

/* ---------- Belief model (public-info only, used by bots) ----------
   Public (viewer-independent) knowledge is maintained incrementally on
   game._pub as events happen (see applyAsk/applyDeclare), so this stays
   O(54) per call no matter how long the game log gets. */
function computeBelief(game, viewerSeat){
  const myHand = new Set(game.hands[viewerSeat]);
  const known = {};
  const possible = {};
  for(const c of DECK){
    if(myHand.has(c.id)){ known[c.id]=viewerSeat; continue; }
    const pk = game._pub.known[c.id];
    if(pk!==undefined){ known[c.id]=pk; continue; }
    const poss = new Set(game._pub.possible[c.id] || []);
    poss.delete(viewerSeat);
    possible[c.id] = poss;
  }
  return {known, possible};
}

function botChooseAsk(game, seat){
  const {known, possible} = computeBelief(game, seat);
  const hand = game.hands[seat];
  const heldSets = new Set(hand.map(c=>CARD_BY_ID[c].setId));
  const opp = new Set(opponents(seat).filter(o=>game.hands[o].length>0));
  const candidates = []; // {cardId, target, p}
  for(const setId of heldSets){
    if(game.discard[setId]) continue;
    for(const cid of SET_CARD_IDS[setId]){
      if(hand.includes(cid)) continue;
      const k = known[cid];
      if(k==='discarded') continue;
      // A card that keeps flip-flopping between teams is a trap: damp its
      // priority so bots don't get stuck endlessly stealing it back and forth.
      const flips = game._pub.flip[cid] || 0;
      const damp = flips>=2 ? Math.pow(0.35, flips-1) : 1;
      if(typeof k === 'number'){
        if(opp.has(k)) candidates.push({cardId:cid, target:k, p:1*damp});
        continue;
      }
      const poss = possible[cid] ? [...possible[cid]].filter(s=>opp.has(s)) : [];
      if(poss.length===0) continue;
      const p = (1/poss.length)*damp;
      for(const t of poss) candidates.push({cardId:cid, target:t, p});
    }
  }
  if(candidates.length===0){
    const legal = legalAskTargets(game, seat);
    if(legal.length===0) return null;
    const pick = legal[Math.floor(Math.random()*legal.length)];
    return {cardId:pick.cardId, target:pick.target};
  }
  // Mostly play the best move, but keep enough randomness that two rivals
  // contesting a single "certain" card can't loop on it forever.
  const maxP = Math.max(...candidates.map(c=>c.p));
  const best = candidates.filter(c=>c.p===maxP);
  const pool = Math.random() < 0.72 ? best : candidates;
  return pool[Math.floor(Math.random()*pool.length)];
}

function botFindDeclare(game, seat){
  const {known} = computeBelief(game, seat);
  const mates = new Set([seat, ...teammates(seat)]);
  for(const setId of activeSets(game)){
    const assignment = {};
    let sure = true;
    for(const cid of SET_CARD_IDS[setId]){
      const k = known[cid];
      if(typeof k === 'number' && mates.has(k)){ assignment[cid]=k; }
      else { sure=false; break; }
    }
    if(sure) return {setId, assignment};
  }
  return null;
}

module.exports = {
  DECK, CARD_BY_ID, SET_IDS, SET_CARD_IDS,
  setLabel, cardLabel, cardIsRed, shortSetTok,
  shuffle, teamOf, teammates, opponents,
  newGame, activeSets, legalAskTargets,
  applyAsk, applyPass, applyDeclare, checkAutoPass,
  seatHolding, bothTeamsCardCounts, computeBelief,
  botChooseAsk, botFindDeclare, forceResolveGame
};
