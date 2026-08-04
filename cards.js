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

window.FishCards = { SET_IDS, SET_CARD_IDS, CARD_BY_ID, setLabel, cardLabel, cardIsRed, shortSetTok };
