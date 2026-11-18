/* Tac Tik — interface, salon, parties contre l'IA et entre amis */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const COLORS = ['#d9291c', '#1f5fd0', '#f2c200', '#1e9b3d'];
  const LEVELS = ['facile', 'moyen', 'difficile'];
  const AI_NAMES = ['', 'Mia', 'Noé', 'Zoé'];
  const SVGNS = 'http://www.w3.org/2000/svg';

  const G = {
    role: null,            // 'host' | 'client'
    S: null,               // état complet (hôte uniquement)
    view: null,            // vue du joueur local
    mySeat: 0,
    acts: [],              // coups légaux du joueur local
    mode: 'teams', swap: true,
    seats: [],             // configuration des sièges (hôte)
    host: null, conn: null, code: null,
    timer: null, waiting: false, boardKey: null,
    lobby: null            // dernier état de salon reçu (client)
  };
  const ui = { card: null, cardIdx: null, act: null, clicked: null, selPawn: null, P: null, seq: [], tgt: null };

  /* ================= utilitaires ================= */
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms || 2200);
  }
  function show(id) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }
  function modal(id, on) { $(id).classList.toggle('hidden', !on); }
  function myName() { return ($('#name').value || '').trim().slice(0, 14) || 'Joueur'; }
  function token() {
    let t = sessionStorage.getItem('tt-token');
    if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('tt-token', t); }
    return t;
  }
  const modeOpts = m => (m === 'duel' ? { n: 2, teams: false } : m === 'teams' ? { n: 4, teams: true } : { n: 4, teams: false });
  const levelLabel = l => LEVELS[l];
  const KLABEL = { '1': '1', '2': '2', '3': '3', '5': '5', '6': '6', '8': '8', '9': '9', '10': '10', '12': '12', '-4': '−4', 'P': '⇄', '7': '7×1' };
  const KSUB = { '1': 'Démarrer<br>ou +1', '10': 'Démarrer<br>ou +10', '-4': 'Reculer', 'P': 'Permuter', '7': '7 pas<br>à répartir' };
  const KORDER = ['1', '2', '3', '-4', '5', '6', '7', '8', '9', '10', '12', 'P'];

  /* ================= MENU ================= */
  $('#name').value = localStorage.getItem('tt-name') || '';
  $('#name').addEventListener('input', () => localStorage.setItem('tt-name', $('#name').value));
  $('#btn-new').onclick = () => { openLobby(); };
  $('#btn-rules').onclick = () => modal('#rules', true);
  $('#rules-close').onclick = () => modal('#rules', false);
  $('#gm-rules').onclick = () => { modal('#gmenu', false); modal('#rules', true); };
  $('#btn-join').onclick = () => joinRoom($('#join-code').value.trim().toUpperCase());
  $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });

  /* ================= SALON (hôte) ================= */
  function defaultSeats(n) {
    const s = [{ type: 'me' }];
    for (let i = 1; i < n; i++) s.push({ type: 'ai', level: 1 });
    return s;
  }
  const PRESETS = {
    solo: { mode: 'teams', seats: ['me', 'ai1', 'ai1', 'ai1'] },           // toi + 1 IA contre 2 IA
    vsai: { mode: 'teams', seats: ['me', 'ai1', 'friend', 'ai1'] },       // toi + un ami contre 2 IA
    t22:  { mode: 'teams', seats: ['me', 'friend', 'friend', 'friend'] }, // toi + un ami contre 2 amis
  };
  function openLobby() {
    G.role = 'host';
    applyPreset(G.preset || 'solo');
    $('#lobby-title').textContent = 'Nouvelle partie';
    $('#lobby-host').classList.remove('hidden');
    $('#lobby-client').classList.add('hidden');
    show('lobby');
  }
  function applyPreset(p) {
    const P = PRESETS[p];
    G.seats.forEach(kick);
    G.preset = p; G.mode = P.mode;
    G.seats = P.seats.map(t => (t === 'me' ? { type: 'me' } : t === 'friend' ? { type: 'friend' } : { type: 'ai', level: +t.slice(2) }));
    $$('#mode-seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === p));
    $('#swap-row').classList.toggle('hidden', G.mode !== 'teams');
    if (G.seats.some(s => s.type === 'friend')) {
      if (typeof Peer === 'undefined') {
        toast('Mode ami indisponible : connexion requise');
        G.seats = G.seats.map(s => (s.type === 'friend' ? { type: 'ai', level: 1 } : s));
      } else ensureHost();
    }
    renderSeats();
  }
  $$('#mode-seg button').forEach(b => b.onclick = () => applyPreset(b.dataset.mode));
  $('#opt-swap').onchange = e => { G.swap = e.target.checked; };
  $('#lobby-back').onclick = () => { leaveAll(); show('menu'); };

  function seatTitle(i) {
    const m = G.mode;
    if (m === 'teams') return (i % 2 === 0 ? 'Équipe A' : 'Équipe B') + (i === 2 ? ' · ton partenaire' : '');
    if (m === 'duel') return i === 0 ? 'Joueur 1' : 'Joueur 2';
    return 'Joueur ' + (i + 1);
  }
  function seatDisplayName(i) {
    const s = G.seats[i];
    if (s.type === 'me') return myName();
    if (s.type === 'ai') return AI_NAMES[i] + ' (IA)';
    return s.name || 'Ami ' + i;
  }
  function renderSeats() {
    const box = $('#seats'); box.innerHTML = '';
    G.seats.forEach((s, i) => {
      const row = document.createElement('div'); row.className = 'seat';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = COLORS[i];
      const who = document.createElement('div'); who.className = 'who';
      who.textContent = s.type === 'me' ? myName() + ' (toi)' : seatDisplayName(i);
      const sm = document.createElement('small'); sm.textContent = seatTitle(i); who.appendChild(sm);
      row.append(dot, who);
      if (s.type === 'me') {
        const b = document.createElement('span'); b.className = 'badge ok'; b.textContent = 'hôte'; row.appendChild(b);
      } else {
        const sel = document.createElement('select');
        [['ai0', 'IA facile'], ['ai1', 'IA moyen'], ['ai2', 'IA difficile'], ['friend', 'Ami en ligne']].forEach(([v, l]) => {
          const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o);
        });
        sel.value = s.type === 'friend' ? 'friend' : 'ai' + s.level;
        sel.onchange = () => setSeatType(i, sel.value);
        row.appendChild(sel);
        if (s.type === 'friend') {
          const b = document.createElement('span');
          b.className = 'badge' + (s.connId ? ' ok' : ''); b.textContent = s.connId ? 'connecté' : 'en attente…';
          row.appendChild(b);
        }
      }
      box.appendChild(row);
    });
    const anyFriend = G.seats.some(s => s.type === 'friend');
    $('#room-box').classList.toggle('hidden', !anyFriend);
    if (anyFriend) $('#room-code').textContent = G.code || '…';
    const waiting = G.seats.filter(s => s.type === 'friend' && !s.connId).length;
    $('#btn-start').disabled = waiting > 0 || !!G.err;
    $('#room-status').textContent = G.err ? G.err : (waiting ? waiting + ' ami(s) attendu(s)' : 'Tout le monde est là');
    broadcastLobby();
  }
  function setSeatType(i, v) {
    const s = G.seats[i];
    kick(s);
    if (v === 'friend') {
      if (typeof Peer === 'undefined') { toast('Mode ami indisponible : connexion requise'); renderSeats(); return; }
      G.seats[i] = { type: 'friend' };
      ensureHost();
    } else {
      G.seats[i] = { type: 'ai', level: +v.slice(2) };
    }
    renderSeats();
  }
  function kick(s) {
    if (s && s.connId && G.host) { G.host.send(s.connId, { t: 'bye' }); }
  }
  function ensureHost() {
    if (G.host) return;
    G.err = null;
    G.host = TTNet.createHost({
      onReady(code) { G.code = code; renderSeats(); },
      onConn() {},
      onMsg: hostMsg,
      onClose: hostClosed,
      onError(err) { G.err = 'Réseau : ' + (err.type || err); renderSeats(); }
    });
  }
  $('#copy-link').onclick = () => {
    const url = location.origin + location.pathname + '?room=' + G.code;
    if (navigator.share) { navigator.share({ title: 'Tac Tik', text: 'Rejoins ma partie de Tac Tik !', url }).catch(() => {}); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
      () => toast('Lien copié !'), () => prompt('Copie ce lien :', url));
  };

  function broadcastLobby() {
    if (!G.host || G.role !== 'host' || G.S) return;
    G.seats.forEach((s, i) => {
      if (s.type === 'friend' && s.connId) G.host.send(s.connId, lobbyMsg(i));
    });
  }
  function lobbyMsg(youSeat) {
    return {
      t: 'lobby', code: G.code, mode: G.mode, youSeat,
      seats: G.seats.map((s, i) => ({ name: seatDisplayName(i), title: seatTitle(i), kind: s.type, ready: s.type !== 'friend' || !!s.connId }))
    };
  }

  /* ----- messages reçus par l'hôte ----- */
  function hostMsg(connId, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      let idx = G.seats.findIndex(s => s.type === 'friend' && s.token && s.token === msg.token);
      if (idx < 0) idx = G.seats.findIndex(s => s.type === 'friend' && !s.connId);
      if (idx < 0) { G.host.send(connId, { t: 'full' }); return; }
      const s = G.seats[idx];
      s.connId = connId; s.token = msg.token; s.connected = true;
      s.name = String(msg.name || 'Ami').slice(0, 14);
      if (G.S) { G.S.names[idx] = s.name; G.S.conn[idx] = true; pushViews(); tick(); }
      else renderSeats();
      return;
    }
    const idx = G.seats.findIndex(s => s.connId === connId);
    if (idx < 0 || !G.S) return;
    if (msg.t === 'act') hostAct(idx, msg.d);
    else if (msg.t === 'swap') hostSwap(idx, msg.k);
  }
  function hostClosed(connId) {
    const idx = G.seats.findIndex(s => s.connId === connId);
    if (idx < 0) return;
    const s = G.seats[idx];
    s.connected = false;
    if (!G.S) { s.connId = null; s.token = null; renderSeats(); return; }
    G.S.conn[idx] = false; pushViews();
    toast(seatDisplayName(idx) + ' s’est déconnecté');
  }

  /* ================= PARTIE (hôte) ================= */
  $('#btn-start').onclick = () => startGame();
  function startGame() {
    const o = modeOpts(G.mode);
    const S = TT.newGame({ n: o.n, teams: o.teams, swap: G.mode === 'teams' && G.swap });
    S.turn = Math.floor(Math.random() * S.n); TT.autoPass(S);
    S.names = G.seats.map((s, i) => seatDisplayName(i));
    S.conn = G.seats.map(s => s.type !== 'friend' || !!s.connected);
    S.log = [];
    G.S = S; G.role = 'host'; G.mySeat = 0; G.waiting = false;
    S.log.push({ n: '', t: 'Nouvelle partie — ' + S.names[S.turn] + ' commence.' }); drainEvents();
    resetUI(); G.boardKey = null;
    show('game'); modal('#over', false);
    pushViews(); tick();
  }
  function makeView(S, seat) {
    return {
      n: S.n, teams: S.teams, swap: S.swap, slots: S.slots, pawns: S.pawns,
      hands: S.hands.map((h, s) => (s === seat ? h : h.map(() => null))),
      deckN: S.deck.length, discardTop: S.discard.length ? S.discard[S.discard.length - 1] : null,
      turn: S.turn, phase: S.phase, swapChoice: (S.swapChoice || []).map(v => v != null),
      winner: S.winner, last: S.last, names: S.names, conn: S.conn, log: S.log.slice(-6),
      turns: S.turns, deals: S.deals
    };
  }
  function pushViews() {
    const S = G.S;
    S.log = S.log.slice(-30);
    S.conn.forEach((c, i) => { if (G.seats[i].type === 'friend' && G.seats[i].connId && G.host) G.host.send(G.seats[i].connId, { t: 'view', seat: i, view: makeView(S, i) }); });
    onView(makeView(S, 0), 0);
  }
  function describe(d, cap) {
    let t;
    switch (d.kind) {
      case 'start': t = 'sort un pion'; break;
      case 'fwd': t = 'avance de ' + d.k; break;
      case 'back': t = 'recule de 4'; break;
      case 'swap': t = 'permute deux pions'; break;
      case 'seven': t = 'joue un 7×1'; break;
      default: t = 'défausse un ' + (KLABEL[d.k] || d.k) + ' (aucun coup)';
    }
    if (cap) t += ' et mange ' + cap + ' pion' + (cap > 1 ? 's' : '');
    return t + '.';
  }
  function drainEvents() {
    const S = G.S;
    (S.events || []).forEach(ev => S.log.push({ n: S.names[ev.seat], t: 'n’a aucun coup possible : sa main (' + ev.n + ' carte' + (ev.n > 1 ? 's' : '') + ') est défaussée.' }));
    S.events = [];
  }
  function hostAct(seat, d) {
    const S = G.S;
    if (!S || S.phase !== 'play' || S.turn !== seat) return;
    const before = S.pawns;
    const r = TT.play(S, seat, d);
    if (!r.ok) { if (seat === 0) { toast('Coup refusé'); G.waiting = false; refresh(); } return; }
    let cap = 0;
    before.forEach((a, s) => a.forEach((x, i) => { if (x.p >= 0 && S.pawns[s][i].p === -1) cap++; }));
    S.log.push({ n: S.names[seat], t: describe(S.last.d, cap) });
    drainEvents();
    pushViews(); tick();
  }
  function hostSwap(seat, k) {
    const S = G.S;
    if (!S || S.phase !== 'swap') return;
    if (!TT.setSwap(S, seat, k)) return;
    if (S.phase === 'play') S.log.push({ n: '', t: 'Cartes échangées entre partenaires.' });
    drainEvents();
    pushViews(); tick();
  }
  const isAI = seat => G.seats[seat].type === 'ai';
  function tick() {
    const S = G.S;
    clearTimeout(G.timer);
    if (!S || S.phase === 'over') return;
    if (S.phase === 'swap') {
      let changed = false;
      for (let s = 0; s < S.n; s++) {
        if (isAI(s) && S.swapChoice[s] == null) { G.timer = setTimeout(() => aiSwap(), 450); return; }
      }
      return;
    }
    const seat = S.turn;
    if (isAI(seat)) G.timer = setTimeout(() => {
      if (!G.S || G.S.phase !== 'play' || G.S.turn !== seat) return;
      hostAct(seat, TTAI.chooseAction(G.S, seat, G.seats[seat].level));
    }, 750 + Math.random() * 450);
  }
  function aiSwap() {
    const S = G.S;
    if (!S || S.phase !== 'swap') return;
    for (let s = 0; s < S.n; s++) {
      if (isAI(s) && S.swapChoice[s] == null) TT.setSwap(S, s, TTAI.chooseSwap(S, s, G.seats[s].level));
    }
    if (S.phase === 'play') S.log.push({ n: '', t: 'Cartes échangées entre partenaires.' });
    drainEvents();
    pushViews(); tick();
  }

  /* ================= CLIENT ================= */
  function joinRoom(code) {
    if (!/^[A-Z2-9]{5}$/.test(code)) { $('#menu-msg').textContent = 'Le code a 5 caractères.'; return; }
    if (typeof Peer === 'undefined') { $('#menu-msg').textContent = 'Connexion requise pour jouer entre amis.'; return; }
    $('#menu-msg').textContent = 'Connexion à la salle ' + code + '…';
    leaveAll();
    G.role = 'client'; G.code = code;
    G.conn = TTNet.joinRoom(code, {
      onOpen() { G.conn.send({ t: 'hello', name: myName(), token: token() }); },
      onMsg: clientMsg,
      onClose() { if (G.role === 'client') { toast('Connexion perdue avec l’hôte'); leaveAll(); show('menu'); $('#menu-msg').textContent = 'Déconnecté de la salle.'; } },
      onError(err) { $('#menu-msg').textContent = err.type === 'peer-unavailable' || err.type === 'timeout' ? 'Salle introuvable (code erroné ou hôte parti).' : 'Erreur réseau : ' + (err.type || err); G.role = null; show('menu'); }
    });
  }
  function clientMsg(msg) {
    if (!msg) return;
    if (msg.t === 'lobby') {
      G.mySeat = msg.youSeat; G.lobby = msg;
      $('#lobby-title').textContent = 'Salle ' + msg.code;
      $('#lobby-host').classList.add('hidden'); $('#lobby-client').classList.remove('hidden');
      $('#client-code').textContent = msg.code;
      const box = $('#client-seats'); box.innerHTML = '';
      msg.seats.forEach((s, i) => {
        const row = document.createElement('div'); row.className = 'seat';
        const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = COLORS[i];
        const who = document.createElement('div'); who.className = 'who'; who.textContent = s.name + (i === msg.youSeat ? ' (toi)' : '');
        const sm = document.createElement('small'); sm.textContent = s.title; who.appendChild(sm);
        const b = document.createElement('span'); b.className = 'badge' + (s.ready ? ' ok' : ''); b.textContent = s.ready ? 'prêt' : 'en attente…';
        row.append(dot, who, b); box.appendChild(row);
      });
      if (!$('#game').classList.contains('active')) show('lobby');
    } else if (msg.t === 'view') {
      G.mySeat = msg.seat;
      if (!$('#game').classList.contains('active')) { G.boardKey = null; show('game'); }
      onView(msg.view, msg.seat);
    } else if (msg.t === 'full') {
      toast('Salle complète ou partie déjà lancée'); leaveAll(); show('menu');
    } else if (msg.t === 'bye') {
      toast('L’hôte vous a retiré de la salle'); leaveAll(); show('menu');
    }
  }
  function leaveAll() {
    clearTimeout(G.timer);
    if (G.host) { G.host.broadcast({ t: 'bye' }); setTimeout(((h) => () => h.close())(G.host), 200); }
    if (G.conn) { const c = G.conn; G.conn = null; G.role = null; c.close(); }
    G.host = null; G.S = null; G.view = null; G.code = null; G.err = null; G.role = null;
    G.seats = []; G.boardKey = null;
    resetUI(); modal('#over', false); modal('#gmenu', false);
  }

  /* ================= INTERFACE DE JEU ================= */
  function resetUI() { ui.card = null; ui.cardIdx = null; ui.act = null; ui.clicked = null; ui.selPawn = null; ui.P = null; ui.seq = []; ui.tgt = null; }
  const myTurn = () => G.view && G.view.phase === 'play' && G.view.turn === G.mySeat;

  function onView(v, seat) {
    G.view = v; G.mySeat = seat; G.waiting = false;
    resetUI();
    G.acts = myTurn() ? TT.legalActions(v, seat) : [];
    refresh(true);
  }

  /* ----- géométrie : plateau carré en bois, circuit en « carré arrondi » ----- */
  const CX = 410, CY = 410, HALF = 300, SE_N = 4.4;
  let rotSlot = 0, SE = null;
  function buildSE() {
    const M = 4096, pts = [], cum = [0];
    let len = 0, prev = null;
    for (let i = 0; i <= M; i++) {
      const th = Math.PI / 2 + (i / M) * 2 * Math.PI, c = Math.cos(th), s = Math.sin(th);
      const x = HALF * Math.sign(c) * Math.pow(Math.abs(c), 2 / SE_N), y = HALF * Math.sign(s) * Math.pow(Math.abs(s), 2 / SE_N);
      pts.push([x, y]);
      if (prev) len += Math.hypot(x - prev[0], y - prev[1]);
      cum.push(len); prev = [x, y];
    }
    SE = { pts, cum, len };
  }
  function loopXY(f) {            // f ∈ [0,1[ : fraction du circuit depuis ma case de départ, sens horaire
    if (!SE) buildSE();
    f = ((f % 1) + 1) % 1;
    const t = f * SE.len;
    let lo = 0, hi = SE.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (SE.cum[m] <= t) lo = m; else hi = m; }
    const u = (t - SE.cum[lo]) / ((SE.cum[hi] - SE.cum[lo]) || 1);
    return [SE.pts[lo][0] + (SE.pts[hi][0] - SE.pts[lo][0]) * u, SE.pts[lo][1] + (SE.pts[hi][1] - SE.pts[lo][1]) * u];
  }
  const ringXY = ring => {
    const f = ((((ring - rotSlot * TT.SEG) % TT.RING) + TT.RING) % TT.RING) / TT.RING;
    const [x, y] = loopXY(f);
    return [CX + x, CY + y];
  };
  const seatRot = (v, s) => ((((v.slots[s] - rotSlot) % 4) + 4) % 4) * 90;    // degrés (sens horaire à l'écran)
  function rot(x, y, deg) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [CX + x * c - y * s, CY + x * s + y * c];
  }
  const homeXY = (v, s, h) => rot(0, HALF - 44 * (h + 1), seatRot(v, s));
  const reserveXY = (v, s, i) => rot(-150 + ((i % 2) - 0.5) * 42, HALF - 74 + ((i >> 1) - 0.5) * 42, seatRot(v, s));
  function pawnXY(v, s, x, i) {
    if (x.p < 0) return reserveXY(v, s, i);
    if (x.p <= TT.LAP) return ringXY(TT.ringOf(v.slots[s], x.p));
    return homeXY(v, s, x.p - TT.HOME0);
  }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  let pawnEls = [], labelEls = [], startRings = [], ghostEl = null;

  function buildBoard(v) {
    const svg = $('#board'); svg.innerHTML = '';
    rotSlot = v.slots[G.mySeat];
    // --- bois ---
    const defs = el('defs', {}, svg);
    const lg = el('linearGradient', { id: 'wood', x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#f0d6a2' }, lg); el('stop', { offset: '.55', 'stop-color': '#e6c58a' }, lg); el('stop', { offset: '1', 'stop-color': '#d9b273' }, lg);
    const pat = el('pattern', { id: 'grain', width: 120, height: 14, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-2)' }, defs);
    el('path', { d: 'M0 4 Q30 1 60 4 T120 4', stroke: 'rgba(120,80,30,.13)', 'stroke-width': 1.4, fill: 'none' }, pat);
    el('path', { d: 'M0 10 Q40 13 80 10 T120 10', stroke: 'rgba(120,80,30,.09)', 'stroke-width': 1, fill: 'none' }, pat);
    const hg = el('radialGradient', { id: 'hole', cx: '.4', cy: '.35', r: '.8' }, defs);
    el('stop', { offset: '0', 'stop-color': '#a8793e' }, hg); el('stop', { offset: '1', 'stop-color': '#cfa466' }, hg);
    el('rect', { x: 22, y: 22, width: 776, height: 776, rx: 26, fill: 'url(#wood)', stroke: '#b78d4f', 'stroke-width': 5 }, svg);
    el('rect', { x: 22, y: 22, width: 776, height: 776, rx: 26, fill: 'url(#grain)' }, svg);
    el('line', { x1: CX, y1: 24, x2: CX, y2: 796, stroke: 'rgba(110,70,25,.28)', 'stroke-width': 3 }, svg);   // pli du plateau
    el('text', { x: CX, y: CY + 150, 'text-anchor': 'middle', fill: 'rgba(90,55,20,.35)', 'font-weight': 900, 'font-size': 34, 'letter-spacing': 6, transform: `rotate(${0} ${CX} ${CY + 150})` }, svg).textContent = 'TAC★TIK';
    // --- cabane (maison) et réserve de chaque joueur ---
    startRings = [];
    v.slots.forEach((sl, s) => {
      const deg = seatRot(v, s), col = COLORS[s];
      const g = el('g', { transform: `translate(${CX},${CY}) rotate(${deg})` }, svg);
      // maison : 4 trous dans une gouttière colorée
      el('rect', { x: -21, y: HALF - 44 * 4 - 24, width: 42, height: 44 * 4 + 6, rx: 21, fill: col + '30', stroke: col, 'stroke-width': 4 }, g);
      for (let h = 0; h < 4; h++) el('circle', { cx: 0, cy: HALF - 44 * (h + 1), r: 12, fill: 'url(#hole)', stroke: col, 'stroke-width': 2.5 }, g);
      // réserve : grande alvéole où les pions attendent
      el('rect', { x: -208, y: HALF - 74 - 50, width: 116, height: 100, rx: 22, fill: 'rgba(110,70,25,.22)', stroke: col, 'stroke-width': 5 }, g);
    });
    // --- circuit : 64 trous ---
    const startOf = {};
    v.slots.forEach((sl, s) => { startOf[TT.ringOf(sl, 0)] = s; });
    for (let r = 0; r < TT.RING; r++) {
      const [x, y] = ringXY(r), s = startOf[r];
      if (s != null) {
        el('circle', { cx: x, cy: y, r: 19, fill: 'none', stroke: '#1d1a17', 'stroke-width': 3 }, svg);
        el('circle', { cx: x, cy: y, r: 14, fill: COLORS[s] + '55', stroke: COLORS[s], 'stroke-width': 3 }, svg);
      } else el('circle', { cx: x, cy: y, r: 11.5, fill: 'url(#hole)', stroke: '#8b6330', 'stroke-width': 2 }, svg);
    }
    v.slots.forEach((sl, s) => {
      const [rx, ry] = ringXY(TT.ringOf(sl, 0));
      const sr = el('circle', { class: 'startring', cx: rx, cy: ry, r: 25 }, svg);
      sr.style.stroke = COLORS[s]; sr.style.opacity = 0;
      startRings[s] = sr;
    });
    // --- noms (sur la marge du plateau) ---
    labelEls = [];
    v.slots.forEach((sl, s) => {
      const deg = seatRot(v, s);
      const [x, y] = rot(0, 352, deg);
      const t = el('text', { class: 'lbl', x: 0, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, svg);
      const r = deg === 90 ? 90 : deg === 270 ? -90 : 0;   // le nom du haut reste lisible
      t.setAttribute('transform', `translate(${x},${y}) rotate(${r})`);
      labelEls[s] = t;
    });
    ghostEl = el('circle', { class: 'ghost', r: 14, cx: 0, cy: 0 }, svg);
    ghostEl.style.display = 'none';
    // --- pions (chevilles de bois vues de dessus) ---
    pawnEls = [];
    v.slots.forEach((sl, s) => {
      pawnEls[s] = [];
      for (let i = 0; i < 4; i++) {
        const g = el('g', { class: 'pawn' }, svg);
        g.dataset.s = s; g.dataset.i = i;
        g.style.transition = 'none';
        el('circle', { class: 'halo', r: 20 }, g);
        el('circle', { class: 'drop', r: 13, cx: 2, cy: 3 }, g);
        const b = el('circle', { class: 'body', r: 12.5 }, g); b.style.fill = COLORS[s];
        el('circle', { class: 'top', r: 7 }, g);
        el('circle', { class: 'shade', r: 3.5, cx: -3.5, cy: -3.5 }, g);
        el('circle', { class: 'pieu', r: 18 }, g);
        pawnEls[s][i] = g;
      }
    });
    G.boardKey = v.n + ':' + v.teams + ':' + G.mySeat;
    requestAnimationFrame(() => requestAnimationFrame(() => pawnEls.forEach(a => a.forEach(g => { g.style.transition = ''; }))));
  }
  $('#board').addEventListener('click', e => {
    const g = e.target.closest('.pawn');
    if (g) onPawnClick(+g.dataset.s, +g.dataset.i);
  });

  /* ----- calcul des surbrillances ----- */
  function computeHL() {
    const v = G.view, r = { hl: new Set(), tgt: new Set(), sel: new Set(), ghost: null, ok: false };
    if (!myTurn() || !ui.card) return r;
    const cs = TT.ctrlSeat(v, G.mySeat);
    const acts = G.acts.filter(a => a.d.k === ui.card);
    const k = ui.card;
    if (k === '7') {
      const P0 = ui.P || v.pawns, left = 7 - ui.seq.length;
      if (left > 0) for (let i = 0; i < 4; i++) {
        const Q = TT.step7(P0, v.slots, cs, i);
        if (Q && TT.feasible7(Q, v.slots, cs, left - 1)) r.hl.add(cs + ':' + i);
      }
      r.ok = ui.seq.length === 7;
    } else if (k === 'P') {
      const mine = new Set(acts.map(a => a.d.pawn));
      mine.forEach(i => r.hl.add(cs + ':' + i));
      if (ui.selPawn != null) {
        r.sel.add(cs + ':' + ui.selPawn);
        acts.filter(a => a.d.pawn === ui.selPawn).forEach(a => r.tgt.add(a.d.tseat + ':' + a.d.tpawn));
        if (ui.tgt) r.sel.add(ui.tgt);
      }
      r.ok = !!ui.act;
    } else {
      let hasStart = false;
      acts.forEach(a => {
        if (a.d.kind === 'start') hasStart = true; else r.hl.add(cs + ':' + a.d.pawn);
      });
      if (hasStart) v.pawns[cs].forEach((x, i) => { if (x.p === -1) r.hl.add(cs + ':' + i); });
      if (ui.act) {
        const a = ui.act;
        r.sel.add(ui.clicked);
        r.ghost = pawnXY(v, cs, a.Q[cs][a.d.pawn], a.d.pawn);
        r.ok = true;
      }
    }
    return r;
  }

  function onPawnClick(s, i) {
    const v = G.view;
    if (!myTurn() || !ui.card || G.waiting) return;
    const cs = TT.ctrlSeat(v, G.mySeat), k = ui.card;
    const acts = G.acts.filter(a => a.d.k === k), key = s + ':' + i;
    const hl = computeHL();
    if (k === '7') {
      if (s !== cs || !hl.hl.has(key)) return;
      const P0 = ui.P || v.pawns;
      ui.P = TT.step7(P0, v.slots, cs, i); ui.seq.push(i);
      ui.act = ui.seq.length === 7 ? { d: { k: '7', kind: 'seven', seq: ui.seq.slice() } } : null;
    } else if (k === 'P') {
      if (ui.selPawn != null && hl.tgt.has(key)) {
        if (ui.tgt === key && ui.act) { confirm(); return; }
        ui.tgt = key;
        ui.act = acts.find(a => a.d.pawn === ui.selPawn && a.d.tseat === s && a.d.tpawn === i) || null;
      } else if (s === cs && hl.hl.has(key)) {
        ui.selPawn = i; ui.tgt = null; ui.act = null;
      } else return;
    } else {
      if (s !== cs || !hl.hl.has(key)) return;
      if (ui.clicked === key && ui.act) { confirm(); return; }
      const isReserve = v.pawns[cs][i].p === -1;
      const a = isReserve ? acts.find(x => x.d.kind === 'start') : acts.find(x => x.d.pawn === i && x.d.kind !== 'start');
      if (!a) return;
      ui.act = a; ui.clicked = key;
    }
    refresh();
  }
  function confirm() {
    if (!ui.act || G.waiting) return;
    sendAction(ui.act.d);
  }
  function sendAction(d) {
    G.waiting = true;
    const dd = d;
    resetUI();
    if (G.role === 'host') hostAct(G.mySeat, dd);
    else if (G.conn) G.conn.send({ t: 'act', d: dd });
    refresh();
  }
  $('#btn-ok').onclick = confirm;
  $('#btn-cancel').onclick = () => { const c = ui.card, ci = ui.cardIdx; resetUI(); ui.card = c; ui.cardIdx = ci; refresh(); };

  function onCard(k, idx) {
    const v = G.view;
    if (!v || G.waiting) return;
    if (v.phase === 'swap') {
      if (v.swapChoice[G.mySeat]) return;
      G.waiting = true;
      if (G.role === 'host') hostSwap(G.mySeat, k); else G.conn.send({ t: 'swap', k });
      refresh(); return;
    }
    if (!myTurn()) return;
    if (!G.acts.length) { sendAction({ k, kind: 'discard' }); return; }
    if (!G.acts.some(a => a.d.k === k)) { toast('Cette carte n’est pas jouable maintenant'); return; }
    resetUI(); ui.card = k; ui.cardIdx = idx;
    const as = G.acts.filter(a => a.d.k === k);
    if (k !== 'P' && k !== '7' && as.length === 1) {
      const cs = TT.ctrlSeat(v, G.mySeat);
      ui.act = as[0]; ui.clicked = cs + ':' + as[0].d.pawn;
    }
    refresh();
  }

  /* ----- rendu ----- */
  function refresh(full) {
    const v = G.view;
    if (!v) return;
    const key = v.n + ':' + v.teams + ':' + G.mySeat;
    if (G.boardKey !== key) buildBoard(v);
    const P = ui.P || v.pawns;
    const hl = computeHL();
    // pions
    v.slots.forEach((sl, s) => {
      for (let i = 0; i < 4; i++) {
        const x = P[s][i], g = pawnEls[s][i];
        const [px, py] = pawnXY(v, s, x, i);
        g.style.transform = `translate(${px}px,${py}px)`;
        g.querySelector('.pieu').style.display = x.u ? 'block' : 'none';
        const k = s + ':' + i;
        g.classList.toggle('hl', hl.hl.has(k) || hl.tgt.has(k));
        g.classList.toggle('sel', hl.sel.has(k));
        g.classList.toggle('tgt', hl.tgt.has(k));
      }
    });
    if (hl.ghost) {
      ghostEl.style.display = ''; ghostEl.setAttribute('cx', hl.ghost[0]); ghostEl.setAttribute('cy', hl.ghost[1]);
      ghostEl.style.stroke = COLORS[TT.ctrlSeat(v, G.mySeat)];
    } else ghostEl.style.display = 'none';
    // noms + tour en cours
    labelEls.forEach((t, s) => {
      const n = (v.names[s] || '') + (s === G.mySeat ? ' (toi)' : '') + (v.conn && v.conn[s] === false ? ' ⚠' : '');
      t.textContent = n;
      t.classList.toggle('turn', v.phase === 'play' && v.turn === s);
    });
    startRings.forEach((r, s) => { r.style.opacity = v.phase === 'play' && v.turn === s ? 1 : 0; });
    // statut
    const st = $('#status');
    st.classList.toggle('me', false);
    if (v.phase === 'over') st.textContent = 'Partie terminée';
    else if (v.phase === 'swap') {
      st.textContent = v.swapChoice[G.mySeat] ? 'En attente des autres joueurs…' : 'Choisis une carte à passer à ton partenaire';
      st.classList.toggle('me', !v.swapChoice[G.mySeat]);
    } else if (myTurn()) {
      st.classList.add('me');
      if (!G.acts.length) st.textContent = 'Aucun coup possible : défausse une carte';
      else if (!ui.card) st.textContent = 'À toi ! Choisis une carte';
      else if (ui.card === '7') st.textContent = ui.seq.length >= 7 ? '7×1 : valide !' : `7×1 : clique un pion (${ui.seq.length}/7)`;
      else if (ui.card === 'P') st.textContent = ui.selPawn == null ? 'Permuter : choisis ton pion' : 'Permuter : choisis le pion cible';
      else st.textContent = ui.act ? 'Valide ou reclique sur le pion' : 'Choisis le pion à jouer';
      const cs = TT.ctrlSeat(v, G.mySeat);
      if (cs !== G.mySeat) st.textContent += ' (pions de ton partenaire)';
    } else {
      st.textContent = 'Tour de ' + v.names[v.turn] + (v.conn && v.conn[v.turn] === false ? ' (déconnecté)' : '');
    }
    $('#deck-n').textContent = v.deckN;
    // centre
    const ci = $('#center-info'); ci.innerHTML = '';
    const mini = document.createElement('div'); mini.className = 'mini';
    mini.textContent = v.discardTop ? (KLABEL[v.discardTop] || v.discardTop) : '·';
    const cap = document.createElement('div'); cap.textContent = 'Donne n° ' + v.deals;
    ci.append(mini, cap);
    // journal
    const lg = $('#log'); lg.innerHTML = '';
    (v.log || []).slice(-2).forEach(l => {
      const d = document.createElement('div');
      if (l.n) { const b = document.createElement('b'); b.textContent = l.n + ' '; d.appendChild(b); }
      d.appendChild(document.createTextNode(l.t)); lg.appendChild(d);
    });
    // main
    renderHand(v);
    // boutons
    $('#btn-ok').disabled = !hl.ok || G.waiting;
    $('#btn-cancel').style.visibility = ui.card && (ui.act || ui.selPawn != null || ui.seq.length) ? 'visible' : 'hidden';
    $('#btn-ok').style.visibility = myTurn() && G.acts.length ? 'visible' : 'hidden';
    // fin
    if (v.phase === 'over') showOver(v); else modal('#over', false);
    // menu
    $('#gm-ai').classList.toggle('hidden', !(G.role === 'host' && v.conn && v.conn.some(c => c === false)));
  }
  function renderHand(v) {
    const h = $('#hand'); h.innerHTML = '';
    const mine = v.hands[G.mySeat] || [];
    const idxs = mine.map((k, i) => i).sort((a, b) => KORDER.indexOf(mine[a]) - KORDER.indexOf(mine[b]));
    idxs.forEach(idx => {
      const k = mine[idx];
      const b = document.createElement('button'); b.className = 'card';
      if (k === '1' || k === '10') b.classList.add('t-start');
      if (k === '-4') b.classList.add('t-back');
      if (k === 'P') b.classList.add('t-swap');
      if (k === '7') b.classList.add('t-seven');
      const big = document.createElement('div'); big.className = 'big'; big.textContent = KLABEL[k];
      const sub = document.createElement('div'); sub.className = 'sub'; sub.innerHTML = KSUB[k] || 'Avancer<br>de ' + k;
      b.append(big, sub);
      const playable = G.acts.some(a => a.d.k === k);
      if (myTurn() && G.acts.length && !playable) b.classList.add('off');
      if (myTurn() && !G.acts.length) b.classList.add('pass');
      if (ui.card && ui.cardIdx === idx) b.classList.add('sel');
      if (v.phase === 'swap' && v.swapChoice[G.mySeat]) b.classList.add('off');
      b.onclick = () => onCard(k, idx);
      h.appendChild(b);
    });
  }
  function showOver(v) {
    const mine = v.teams ? (v.winner === G.mySeat % 2) : (v.winner === G.mySeat);
    const names = v.teams ? [v.names[v.winner], v.names[v.winner + 2]].join(' & ') : v.names[v.winner];
    $('#over-title').textContent = mine ? '🎉 Victoire !' : 'Défaite';
    $('#over-text').textContent = (v.teams ? 'L’équipe ' : '') + names + (v.teams ? ' l’emporte.' : ' l’emporte.');
    $('#over-again').classList.toggle('hidden', G.role !== 'host');
    modal('#over', true);
  }
  $('#over-again').onclick = () => startGame();
  $('#over-quit').onclick = () => { leaveAll(); show('menu'); };

  /* ----- menu en jeu ----- */
  $('#g-menu').onclick = () => modal('#gmenu', true);
  $('#gm-close').onclick = () => modal('#gmenu', false);
  $('#gm-quit').onclick = () => { if (confirmQuit()) { leaveAll(); show('menu'); } };
  const confirmQuit = () => window.confirm('Quitter la partie ?');
  $('#gm-ai').onclick = () => {
    G.seats.forEach((s, i) => {
      if (s.type === 'friend' && !s.connected) { G.seats[i] = { type: 'ai', level: 1 }; G.S.names[i] = seatDisplayName(i); G.S.conn[i] = true; }
    });
    modal('#gmenu', false); pushViews(); tick();
  };

  /* ================= démarrage ================= */
  const q = new URLSearchParams(location.search).get('room');
  if (q) {
    $('#join-code').value = q.toUpperCase();
    joinRoom(q.toUpperCase());
  }
  window.__tt = { G, ui, startGame, applyPreset };
})();
