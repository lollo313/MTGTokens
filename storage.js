// storage.js
// Piccolo wrapper su localStorage. Tutto lo stato vive sul dispositivo:
// nessun server, nessun account, nessuna sincronizzazione.

const Storage = {
  KEYS: {
    DECK_HASH: 'tt_deck_hash',
    DECK_CARDS: 'tt_deck_cards',   // nomi carta del mazzo attivo
    TOKENS: 'tt_tokens',           // token risolti (id, nome, immagine) per il mazzo attivo
    COUNTS: 'tt_counts'            // contatori correnti { tokenId: numero }
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
    const zeroCounts = {};
    tokens.forEach(t => { zeroCounts[t.id] = 0; });
    localStorage.setItem(this.KEYS.COUNTS, JSON.stringify(zeroCounts));
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
      counts: JSON.parse(localStorage.getItem(this.KEYS.COUNTS) || '{}')
    };
  },

  setCount(tokenId, value) {
    const counts = JSON.parse(localStorage.getItem(this.KEYS.COUNTS) || '{}');
    counts[tokenId] = Math.max(0, value);
    localStorage.setItem(this.KEYS.COUNTS, JSON.stringify(counts));
    return counts[tokenId];
  },

  resetCounts() {
    const tokensRaw = localStorage.getItem(this.KEYS.TOKENS);
    if (!tokensRaw) return;
    const tokens = JSON.parse(tokensRaw);
    const zeroCounts = {};
    tokens.forEach(t => { zeroCounts[t.id] = 0; });
    localStorage.setItem(this.KEYS.COUNTS, JSON.stringify(zeroCounts));
  },

  clearDeck() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
  }
};
