// scryfall.js
// Tutta la logica di interrogazione di Scryfall.
// Endpoint usato: POST /cards/collection, che accetta fino a 75
// identificatori per richiesta -> per un mazzo di 100 carte bastano 2 chiamate,
// molto più efficiente che una fuzzy-search per carta.

const Scryfall = {
  API_BASE: 'https://api.scryfall.com',
  MAX_BATCH: 75,

  chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  },

  async postCollection(identifiers) {
    const batches = this.chunk(identifiers, this.MAX_BATCH);
    const results = [];
    for (const batch of batches) {
      const res = await fetch(`${this.API_BASE}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch })
      });
      if (!res.ok) {
        throw new Error(`Scryfall ha risposto con errore ${res.status}`);
      }
      const data = await res.json();
      results.push(...data.data);
      // data.not_found contiene eventuali carte non trovate: le ignoriamo qui,
      // ma potresti loggarle per segnalare errori di battitura nella decklist.
    }
    return results;
  },

  /**
   * Data una lista di nomi carta, ritorna la lista di token univoci
   * (con id, nome, immagine) che quelle carte possono generare,
   * usando il campo `all_parts` di ogni carta.
   */
  async resolveTokensForDeck(cardNames) {
    const uniqueNames = [...new Set(cardNames.filter(Boolean))];
    if (uniqueNames.length === 0) return { tokens: [], notFound: [] };

    const identifiers = uniqueNames.map(name => ({ name }));
    const cards = await this.postCollection(identifiers);

    const tokenIds = new Set();
    for (const card of cards) {
      if (!card.all_parts) continue;
      for (const part of card.all_parts) {
        if (part.component === 'token') tokenIds.add(part.id);
      }
    }

    if (tokenIds.size === 0) return { tokens: [], notFound: [] };

    const tokenIdentifiers = [...tokenIds].map(id => ({ id }));
    const tokenCards = await this.postCollection(tokenIdentifiers);

    const tokens = tokenCards.map(t => ({
      id: t.id,
      name: t.name,
      // preferisci l'immagine normal, ricadi su altre dimensioni se assente
      image: t.image_uris?.normal || t.image_uris?.large || t.image_uris?.small || null,
      typeLine: t.type_line || '',
      oracleText: t.oracle_text || ''
    })).sort((a, b) => a.name.localeCompare(b.name, 'it'));

    return { tokens, cardCount: cards.length };
  }
};
