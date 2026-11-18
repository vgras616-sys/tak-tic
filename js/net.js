/* Tac Tik — couche réseau (WebRTC pair-à-pair via PeerJS, aucun serveur à héberger).
   L'hôte fait autorité : il valide les coups et envoie à chacun sa vue (sans les mains des autres). */
(function (root) {
  'use strict';
  const PREFIX = 'tactik-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PEER_OPTS = {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'], username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    }
  };

  function randomCode() {
    let c = '';
    const a = new Uint8Array(5);
    (self.crypto || window.crypto).getRandomValues(a);
    a.forEach(v => { c += ALPHABET[v % ALPHABET.length]; });
    return c;
  }

  // ---- hôte ----
  function createHost(handlers) {
    // handlers: {onReady(code), onConn(connId), onMsg(connId,msg), onClose(connId), onError(err)}
    const conns = new Map();
    let peer = null, code = null, tries = 0, closed = false, wake = null;
    function keepAwake() {
      try { if (navigator.wakeLock && !document.hidden) navigator.wakeLock.request('screen').then(w => { wake = w; }).catch(() => {}); } catch (e) {}
    }
    document.addEventListener('visibilitychange', () => {
      if (closed || document.hidden) return;
      keepAwake();
      if (peer && peer.disconnected && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
    });
    keepAwake();
    function open() {
      if (!code) code = randomCode();   // le code reste le même si la liaison est recréée
      peer = new Peer(PREFIX + code, PEER_OPTS);
      peer.on('open', () => handlers.onReady(code));
      // sur téléphone, quitter l'onglet (pour envoyer le lien) coupe la liaison avec le courtier : on la rétablit
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
      peer.on('close', () => { if (!closed) { try { open(); } catch (e) {} } });
      peer.on('error', err => {
        if (err.type === 'unavailable-id' && tries++ < 5) { code = null; try { peer.destroy(); } catch (e) {} open(); return; }
        if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') { setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 2000); return; }
        handlers.onError(err);
      });
      peer.on('connection', conn => {
        const id = conn.peer;
        conn.on('open', () => { conns.set(id, conn); handlers.onConn(id); });
        conn.on('data', msg => handlers.onMsg(id, msg));
        conn.on('close', () => { if (conns.get(id) === conn) conns.delete(id); handlers.onClose(id); });
        conn.on('error', () => {});
      });
    }
    open();
    return {
      get code() { return code; },
      send(id, msg) { const c = conns.get(id); if (c && c.open) c.send(msg); },
      broadcast(msg) { conns.forEach(c => { if (c.open) c.send(msg); }); },
      has(id) { return conns.has(id); },
      close() { closed = true; try { if (wake) wake.release(); conns.forEach(c => c.close()); peer.destroy(); } catch (e) {} }
    };
  }

  // ---- client ----
  function joinRoom(code, handlers) {
    // handlers: {onOpen(), onMsg(msg), onClose(), onError(err)}
    const peer = new Peer(undefined, PEER_OPTS);
    let conn = null, opened = false, attempts = 0, dead = false;
    const timeout = setTimeout(() => { if (!opened && !dead) handlers.onError({ type: 'timeout' }); }, 25000);
    function attempt() {
      attempts++;
      conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      conn.on('open', () => { opened = true; clearTimeout(timeout); handlers.onOpen(); });
      conn.on('data', msg => handlers.onMsg(msg));
      conn.on('close', () => handlers.onClose());
      conn.on('error', err => handlers.onError(err));
    }
    peer.on('open', attempt);
    peer.on('error', err => {
      // l'hôte peut être en train de se reconnecter : on réessaie quelques fois
      if (err.type === 'peer-unavailable' && !opened && attempts < 8) { setTimeout(() => { if (!dead) attempt(); }, 2500); return; }
      clearTimeout(timeout); handlers.onError(err);
    });
    return {
      send(msg) { if (conn && conn.open) conn.send(msg); },
      close() { dead = true; try { clearTimeout(timeout); if (conn) conn.close(); peer.destroy(); } catch (e) {} }
    };
  }

  root.TTNet = { createHost, joinRoom };
})(window);
