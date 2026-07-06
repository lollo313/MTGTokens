// storage.js
// Piccolo wrapper su localStorage. Tutto lo stato vive sul dispositivo:
// nessun server, nessun account, nessuna sincronizzazione.

const Storage = {
  KEYS: {
    DECK_HASH: 'tt_deck_hash',
    DECK_CARDS: 'tt_deck_cards',   // nomi carta del mazzo attivo
    TOKENS: 'tt_tokens',           // token risolti (id, nome, immagine) per il mazzo attivo
    STATE: 'tt_state'              // stato di gioco { tokenId: {untapped, tapped} }
  },

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

  saveDeck(cardNames, tokens) {
    const hash = this.hashList(cardNames);
    localStorage.setItem(this.KEYS.DECK_HASH, hash);
    localStorage.setItem(this.KEYS.DECK_CARDS, JSON.stringify(cardNames));
    localStorage.setItem(this.KEYS.TOKENS, JSON.stringify(tokens));
    // Stato iniziale: nessun token in gioco (tutti a 0/0).
    const state = {};
    tokens.forEach(t => { state[t.id] = { untapped: 0, tapped: 0 }; });
    localStorage.setItem(this.KEYS.STATE, JSON.stringify(state));
    return hash;
  },

  loadDeck() {
    const tokensRaw = localStorage.getItem(this.KEYS.TOKENS);
    const cardsRaw = localStorage.getItem(this.KEYS.DECK_CARDS);
    if (!tokensRaw || !cardsRaw) return null;
    return {
      hash: localStorage.getItem(this.KEYS.DECK_HASH),
      cardNames: JSON.parse(cardsRaw),
      tokens: JSON.parse(tokensRaw),
      state: JSON.parse(localStorage.getItem(this.KEYS.STATE) || '{}')
    };
  },

  _loadState() {
    return JSON.parse(localStorage.getItem(this.KEYS.STATE) || '{}');
  },

  _saveState(state) {
    localStorage.setItem(this.KEYS.STATE, JSON.stringify(state));
  },

  _entry(state, tokenId) {
    if (!state[tokenId]) state[tokenId] = { untapped: 0, tapped: 0 };
    return state[tokenId];
  },

  total(tokenId) {
    const e = this._entry(this._loadState(), tokenId);
    return e.untapped + e.tapped;
  },

  getEntry(tokenId) {
    return { ...this._entry(this._loadState(), tokenId) };
  },

  // Aggiunge un token in gioco: entra stappato.
  addOne(tokenId) {
    const state = this._loadState();
    this._entry(state, tokenId).untapped++;
    this._saveState(state);
    return this.getEntry(tokenId);
  },

  // Rimuove esplicitamente un'unità stappata.
  removeUntapped(tokenId) {
    const state = this._loadState();
    const e = this._entry(state, tokenId);
    if (e.untapped > 0) e.untapped--;
    this._saveState(state);
    return this.getEntry(tokenId);
  },

  // Rimuove esplicitamente un'unità tappata.
  removeTapped(tokenId) {
    const state = this._loadState();
    const e = this._entry(state, tokenId);
    if (e.tapped > 0) e.tapped--;
    this._saveState(state);
    return this.getEntry(tokenId);
  },

  // Tappa un'unità: stappati -> tappati.
  tapOne(tokenId) {
    const state = this._loadState();
    const e = this._entry(state, tokenId);
    if (e.untapped > 0) { e.untapped--; e.tapped++; }
    this._saveState(state);
    return this.getEntry(tokenId);
  },

  // Stappa un'unità: tappati -> stappati.
  untapOne(tokenId) {
    const state = this._loadState();
    const e = this._entry(state, tokenId);
    if (e.tapped > 0) { e.tapped--; e.untapped++; }
    this._saveState(state);
    return this.getEntry(tokenId);
  },

  // Azzera i contatori mantenendo il mazzo (nuova partita).
  resetState() {
    const tokensRaw = localStorage.getItem(this.KEYS.TOKENS);
    if (!tokensRaw) return;
    const tokens = JSON.parse(tokensRaw);
    const state = {};
    tokens.forEach(t => { state[t.id] = { untapped: 0, tapped: 0 }; });
    this._saveState(state);
  },

  clearDeck() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
  }
};
