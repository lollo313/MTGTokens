// storage.js
// Piccolo wrapper su localStorage. Tutto lo stato vive sul dispositivo:
// nessun server, nessun account, nessuna sincronizzazione.
//
// Modello dati: ogni token in gioco è una lista di ISTANZE individuali.
//   { tokenId: { instances: [ { tapped: bool, p: int, t: int } ] } }
// p/t è il modificatore forza/costituzione dell'istanza (0/0 = nessun segnalino).

const Storage = {
  KEYS: {
    DECK_HASH: 'tt_deck_hash',
    DECK_CARDS: 'tt_deck_cards',   // nomi carta del mazzo attivo
    DECK_TITLE: 'tt_deck_title',   // titolo del mazzo attivo (dato dall'utente)
    TOKENS: 'tt_tokens',           // token risolti (id, nome, immagine) per il mazzo attivo
    STATE: 'tt_state'              // stato di gioco { tokenId: { instances: [...] } }
  },

  // Storico dei mazzi importati. Chiave FUORI da KEYS di proposito: "Cambia mazzo"
  // (clearDeck) itera KEYS e non deve cancellare lo storico.
  RECENT_KEY: 'tt_recent_decks',
  RECENT_MAX: 24,

  // hash semplice e stabile della decklist, per capire se è "lo stesso mazzo"
  // ed evitare di richiamare Scryfall se non serve.
  hashList(cardNames) {
    const joined = [...cardNames].sort().join('|');
    let hash = 0;
    for (let i = 0; i < joined.length; i++) {
      hash = (hash * 31 + joined.charCodeAt(i)) >>> 0;
    }
    return String(hash);
  },

  saveDeck(cardNames, tokens, title = '') {
    const hash = this.hashList(cardNames);
    localStorage.setItem(this.KEYS.DECK_HASH, hash);
    localStorage.setItem(this.KEYS.DECK_CARDS, JSON.stringify(cardNames));
    localStorage.setItem(this.KEYS.DECK_TITLE, title);
    localStorage.setItem(this.KEYS.TOKENS, JSON.stringify(tokens));
    // Stato iniziale: nessun token in gioco.
    localStorage.setItem(this.KEYS.STATE, JSON.stringify({}));
    return hash;
  },

  // Aggiorna la sola lista token (es. copie create a runtime) senza toccare
  // lo stato di gioco, che è indicizzato per id e persiste a parte.
  saveTokens(tokens) {
    localStorage.setItem(this.KEYS.TOKENS, JSON.stringify(tokens));
  },

  loadDeck() {
    const tokensRaw = localStorage.getItem(this.KEYS.TOKENS);
    const cardsRaw = localStorage.getItem(this.KEYS.DECK_CARDS);
    if (!tokensRaw || !cardsRaw) return null;
    return {
      hash: localStorage.getItem(this.KEYS.DECK_HASH),
      title: localStorage.getItem(this.KEYS.DECK_TITLE) || '',
      cardNames: JSON.parse(cardsRaw),
      tokens: JSON.parse(tokensRaw),
      state: this._loadState()
    };
  },

  // --- storico mazzi recenti ---
  // Ogni voce: { id (hash decklist), title, cardNames, tokens, savedAt }.
  // Lo stato di gioco NON viene salvato qui: riaprire un mazzo recente
  // ricomincia da una board pulita.
  getRecentDecks() {
    try {
      const arr = JSON.parse(localStorage.getItem(this.RECENT_KEY) || '[]');
      if (!Array.isArray(arr)) return [];
      return arr.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    } catch (e) {
      return [];
    }
  },

  getRecentDeck(id) {
    return this.getRecentDecks().find(d => d.id === id) || null;
  },

  // Inserisce/aggiorna un mazzo nello storico (dedup per hash della decklist)
  // e lo porta in cima. Tiene al massimo RECENT_MAX voci.
  saveRecentDeck(title, cardNames, tokens) {
    const id = this.hashList(cardNames);
    const list = this.getRecentDecks().filter(d => d.id !== id);
    list.unshift({ id, title: title || '', cardNames, tokens, savedAt: Date.now() });
    localStorage.setItem(this.RECENT_KEY, JSON.stringify(list.slice(0, this.RECENT_MAX)));
    return id;
  },

  // Aggiorna solo il timestamp di un mazzo riaperto, per riportarlo in cima.
  touchRecentDeck(id) {
    const list = this.getRecentDecks();
    const entry = list.find(d => d.id === id);
    if (!entry) return;
    entry.savedAt = Date.now();
    localStorage.setItem(this.RECENT_KEY, JSON.stringify(list));
  },

  clearRecentDecks() {
    localStorage.removeItem(this.RECENT_KEY);
  },

  _loadState() {
    const state = JSON.parse(localStorage.getItem(this.KEYS.STATE) || '{}');
    // Migrazione dal vecchio formato { untapped, tapped, counters }:
    // i conteggi diventano istanze, i segnalini nominali non sono mappabili
    // su forza/costituzione e decadono.
    let migrated = false;
    for (const id of Object.keys(state)) {
      const e = state[id];
      if (e && !Array.isArray(e.instances) && (typeof e.untapped === 'number' || typeof e.tapped === 'number')) {
        const instances = [];
        for (let i = 0; i < (e.untapped || 0); i++) instances.push({ tapped: false, p: 0, t: 0 });
        for (let i = 0; i < (e.tapped || 0); i++) instances.push({ tapped: true, p: 0, t: 0 });
        state[id] = { instances };
        migrated = true;
      }
    }
    if (migrated) this._saveState(state);
    return state;
  },

  _saveState(state) {
    localStorage.setItem(this.KEYS.STATE, JSON.stringify(state));
  },

  _entry(state, tokenId) {
    if (!state[tokenId] || !Array.isArray(state[tokenId].instances)) {
      state[tokenId] = { instances: [] };
    }
    return state[tokenId];
  },

  total(tokenId) {
    return this._entry(this._loadState(), tokenId).instances.length;
  },

  getInstances(tokenId) {
    return this._entry(this._loadState(), tokenId).instances.map(i => ({ ...i }));
  },

  // Aggiunge un'istanza: entra stappata e senza segnalini.
  addOne(tokenId) {
    const state = this._loadState();
    this._entry(state, tokenId).instances.push({ tapped: false, p: 0, t: 0 });
    this._saveState(state);
  },

  // Rimuove le istanze agli indici dati (0-based).
  removeAt(tokenId, indices) {
    const state = this._loadState();
    const e = this._entry(state, tokenId);
    const drop = new Set(indices);
    e.instances = e.instances.filter((_, i) => !drop.has(i));
    if (e.instances.length === 0) delete state[tokenId];
    this._saveState(state);
  },

  // Tappa/stappa la singola istanza.
  toggleTap(tokenId, index) {
    const state = this._loadState();
    const inst = this._entry(state, tokenId).instances[index];
    if (inst) inst.tapped = !inst.tapped;
    this._saveState(state);
  },

  // Applica un modificatore p/t alle istanze indicate.
  // replace=false somma al modificatore esistente, replace=true lo sostituisce.
  applyCounter(tokenId, indices, dp, dt, replace = false) {
    const state = this._loadState();
    const e = this._entry(state, tokenId);
    for (const i of indices) {
      const inst = e.instances[i];
      if (!inst) continue;
      inst.p = replace ? dp : (inst.p || 0) + dp;
      inst.t = replace ? dt : (inst.t || 0) + dt;
    }
    this._saveState(state);
  },

  // Azzera i segnalini delle istanze indicate.
  clearCounters(tokenId, indices) {
    this.applyCounter(tokenId, indices, 0, 0, true);
  },

  // Azzera lo stato mantenendo il mazzo (nuova partita).
  resetState() {
    this._saveState({});
  },

  clearDeck() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
  }
};
