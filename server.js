const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  teamOf, teammates, newGame, activeSets, legalAskTargets,
  applyAsk, applyPass, applyDeclare, botChooseAsk, botFindDeclare,
  forceResolveGame
} = require('./engine');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = {}; // code -> room
const socketIndex = {}; // socket.id -> { code }

function genCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  do {
    c = '';
    for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms[c]);
  return c;
}

function emptySeats() {
  const seats = [];
  for (let s = 0; s < 6; s++) {
    seats.push({ seat: s, name: '', team: teamOf(s), isBot: false, playerId: null, socketId: null, connected: false });
  }
  return seats;
}

function publicSeats(room) {
  return room.seats.map(s => ({
    seat: s.seat, name: s.name, team: s.team, isBot: s.isBot,
    present: !!(s.playerId || s.isBot), connected: s.isBot ? true : s.connected
  }));
}

function broadcastLobby(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('room_update', {
    code: room.code, phase: room.phase, hostSeat: room.hostSeat, seats: publicSeats(room)
  });
}

function publicGameState(room) {
  const g = room.game;
  if (!g) return null;
  return {
    seats: room.seats.map(s => ({ seat: s.seat, name: s.name, team: s.team, isBot: s.isBot, connected: s.isBot ? true : s.connected })),
    turn: g.turn,
    log: g.log,
    scores: g.scores,
    discard: g.discard,
    phase: g.phase,
    winner: g.winner,
    pendingPass: g.pendingPass,
    autoPlay: room.autoPlay !== false,
    handCounts: [0,1,2,3,4,5].map(s => g.hands[s].length)
  };
}

function broadcastGame(code) {
  const room = rooms[code];
  if (!room || !room.game) return;
  const base = publicGameState(room);
  // send each connected human a copy of the update with their own hand embedded,
  // so there's no window where the board is visible but the hand hasn't arrived yet
  for (const s of room.seats) {
    if (s.isBot || !s.socketId) continue;
    io.to(s.socketId).emit('game_update', { ...base, yourHand: room.game.hands[s.seat] });
  }
}

const BOT_ASK_DELAY_MS = 6400; // pause between bot actions so people can read the log

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

/* Perform exactly one bot decision (a declare, a pass, or an ask) and apply it.
   Returns true if something happened, false if there's nothing for a bot to do
   right now (e.g. it's a human's turn). Used both by the automatic loop and by
   the manual "Next bot move" button. */
function stepOnce(room) {
  const g = room.game;
  if (!g || g.phase !== 'playing') return false;
  if (g.actionCount > 900) { forceResolveGame(g); return true; }

  for (let s = 0; s < 6; s++) {
    if (!room.seats[s].isBot) continue;
    const d = botFindDeclare(g, s);
    if (d) { applyDeclare(g, s, d.setId, d.assignment); return true; }
  }
  if (g.phase !== 'playing') return true;

  if (g.pendingPass) {
    const cur = g.turn;
    if (room.seats[cur].isBot) {
      const mates = teammates(cur).filter(m => g.hands[m].length > 0);
      if (mates.length) { applyPass(g, cur, mates[0]); return true; }
    }
    return false; // waiting on a human to pass
  }

  const cur = g.turn;
  if (!room.seats[cur].isBot) return false; // wait for human
  if (g.hands[cur].length === 0) return false;
  const choice = botChooseAsk(g, cur);
  if (!choice) return false;
  applyAsk(g, cur, choice.target, choice.cardId);
  return true;
}

/* Run bot decisions one at a time, broadcasting after each single action so
   everyone watching sees the log fill in gradually instead of jumping ahead.
   Stops as soon as room.autoPlay is turned off. */
async function runBots(room) {
  if (room._botLoopRunning) return;
  room._botLoopRunning = true;
  try {
    while (rooms[room.code] === room && room.game && room.game.phase === 'playing' && room.autoPlay) {
      const acted = stepOnce(room);
      if (!acted) break;
      broadcastGame(room.code);
      await sleep(BOT_ASK_DELAY_MS);
    }
  } finally {
    room._botLoopRunning = false;
  }
}

function seatOf(room, playerId) {
  return room.seats.find(s => s.playerId === playerId);
}

io.on('connection', socket => {
  socket.on('create_room', ({ name, playerId }, cb) => {
    const code = genCode();
    const seats = emptySeats();
    seats[0] = { seat: 0, name: (name || 'Player').slice(0, 16), team: teamOf(0), isBot: false, playerId, socketId: socket.id, connected: true };
    rooms[code] = { code, hostSeat: 0, hostPlayerId: playerId, phase: 'lobby', seats, game: null };
    socket.join(code);
    socketIndex[socket.id] = { code };
    cb({ ok: true, code, seat: 0 });
    broadcastLobby(code);
  });

  socket.on('join_room', ({ code, name, playerId }, cb) => {
    code = (code || '').toUpperCase();
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'No room found with that code.' });

    let seat = seatOf(room, playerId);
    if (seat) {
      // reconnect to existing seat
      seat.socketId = socket.id;
      seat.connected = true;
      if (name) seat.name = name.slice(0, 16);
      socket.join(code);
      socketIndex[socket.id] = { code };
      cb({ ok: true, code, seat: seat.seat, phase: room.phase });
      broadcastLobby(code);
      if (room.phase === 'playing' || room.phase === 'ended') broadcastGame(code);
      return;
    }

    if (room.phase !== 'lobby') return cb({ ok: false, error: 'That game has already started.' });
    const open = room.seats.find(s => !s.playerId && !s.isBot);
    if (!open) return cb({ ok: false, error: 'That room is full.' });
    open.playerId = playerId;
    open.name = (name || 'Player').slice(0, 16);
    open.socketId = socket.id;
    open.connected = true;
    socket.join(code);
    socketIndex[socket.id] = { code };
    cb({ ok: true, code, seat: open.seat, phase: room.phase });
    broadcastLobby(code);
  });

  socket.on('fill_bot', ({ code, seat, botName }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'lobby') return;
    if (room.hostPlayerId !== playerIdForSocket(room, socket.id)) return;
    const s = room.seats[seat];
    if (!s || s.playerId) return;
    s.isBot = true; s.name = botName || ('Bot ' + (seat + 1)); s.connected = true;
    broadcastLobby(code);
  });

  socket.on('clear_seat', ({ code, seat }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'lobby') return;
    if (room.hostPlayerId !== playerIdForSocket(room, socket.id)) return;
    const s = room.seats[seat];
    if (!s || seat === room.hostSeat) return;
    s.isBot = false; s.name = ''; s.playerId = null; s.socketId = null; s.connected = false;
    broadcastLobby(code);
  });

  socket.on('start_game', ({ code }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'lobby') return;
    if (room.hostPlayerId !== playerIdForSocket(room, socket.id)) return;
    if (!room.seats.every(s => s.playerId || s.isBot)) return;
    const seatMeta = room.seats.map(s => ({ seat: s.seat, name: s.name || ('Seat ' + (s.seat + 1)), isBot: s.isBot, team: s.team }));
    room.game = newGame(seatMeta);
    room.phase = 'playing';
    room.autoPlay = true;
    broadcastLobby(code);
    broadcastGame(code);
    runBots(room).catch(e => console.error("bot loop error", e));
  });

  socket.on('ask', ({ code, target, cardId }) => {
    const room = rooms[code];
    if (!room || !room.game || room.phase !== 'playing') return;
    const seat = seatOf(room, playerIdForSocket(room, socket.id));
    if (!seat) return;
    const g = room.game;
    if (g.turn !== seat.seat) return;
    const legal = legalAskTargets(g, seat.seat).some(l => l.cardId === cardId && l.target === target);
    if (!legal) return;
    applyAsk(g, seat.seat, target, cardId);
    broadcastGame(code);
    runBots(room).catch(e => console.error("bot loop error", e));
  });

  socket.on('declare', ({ code, setId, assignment }) => {
    const room = rooms[code];
    if (!room || !room.game || room.phase !== 'playing') return;
    const seat = seatOf(room, playerIdForSocket(room, socket.id));
    if (!seat) return;
    applyDeclare(room.game, seat.seat, setId, assignment);
    broadcastGame(code);
    runBots(room).catch(e => console.error("bot loop error", e));
  });

  socket.on('pass', ({ code, to }) => {
    const room = rooms[code];
    if (!room || !room.game || room.phase !== 'playing') return;
    const seat = seatOf(room, playerIdForSocket(room, socket.id));
    if (!seat) return;
    const g = room.game;
    if (!g.pendingPass || g.turn !== seat.seat) return;
    if (!teammates(seat.seat).includes(to)) return;
    if (g.hands[to].length === 0) return;
    applyPass(g, seat.seat, to);
    broadcastGame(code);
    runBots(room).catch(e => console.error("bot loop error", e));
  });

  socket.on('set_autoplay', ({ code, auto }) => {
    const room = rooms[code];
    if (!room || !room.game) return;
    room.autoPlay = !!auto;
    broadcastGame(code);
    if (room.autoPlay) runBots(room).catch(e => console.error('bot loop error', e));
  });

  socket.on('bot_step', ({ code }) => {
    const room = rooms[code];
    if (!room || !room.game || room.phase !== 'playing') return;
    if (room.autoPlay) return; // manual stepping only applies while autoplay is off
    const acted = stepOnce(room);
    if (acted) broadcastGame(code);
  });

  socket.on('leave_room', ({ code }) => {
    handleLeave(socket, code);
  });

  socket.on('disconnect', () => {
    const info = socketIndex[socket.id];
    if (info) handleLeave(socket, info.code);
  });

  function handleLeave(socket, code) {
    const room = rooms[code];
    delete socketIndex[socket.id];
    if (!room) return;
    const seat = room.seats.find(s => s.socketId === socket.id);
    if (seat) { seat.connected = false; seat.socketId = null; }
    socket.leave(code);
    if (room.phase === 'lobby') broadcastLobby(code);
    else broadcastGame(code);
    const anyoneLeft = room.seats.some(s => s.connected);
    if (!anyoneLeft) {
      setTimeout(() => {
        if (rooms[code] && !room.seats.some(s => s.connected)) delete rooms[code];
      }, 1000 * 60 * 30); // clean up abandoned rooms after 30 min
    }
  }
});

function playerIdForSocket(room, socketId) {
  const seat = room.seats.find(s => s.socketId === socketId);
  return seat ? seat.playerId : null;
}

server.listen(PORT, () => console.log('Fish server listening on port ' + PORT));
