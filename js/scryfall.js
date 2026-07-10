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

  // immagine di una carta, gestendo anche le doppia-faccia
  cardImage(c) {
    return c.image_uris?.normal || c.image_uris?.large || c.image_uris?.small
      || c.card_faces?.[0]?.image_uris?.normal
      || c.card_faces?.[0]?.image_uris?.large || null;
  },

  cardToToken(c) {
    const oracle = c.oracle_text || '';
    return {
      id: c.id,
      name: c.name,
      image: this.cardImage(c),
      typeLine: c.type_line || '',
      oracleText: oracle,
      power: c.power ?? null,
      toughness: c.toughness ?? null,
      colors: c.colors || null,
      isCopy: c.name === 'Copy' || /copy of a permanent/i.test(oracle)
    };
  },

  // Firma di equivalenza di un token: stessi nome, tipo, forza/costituzione,
  // colori e testo => è lo "stesso" token stampato in set diversi (id/arte
  // diversi), quindi va mostrato una volta sola.
  tokenSignature(c) {
    return [
      (c.name || '').toLowerCase().trim(),
      (c.type_line || '').toLowerCase().trim(),
      c.power ?? '',
      c.toughness ?? '',
      (c.colors || []).slice().sort().join(''),
      (c.oracle_text || '').toLowerCase().trim()
    ].join('|');
  },

  // Suggerimenti di nomi carta (autocomplete ufficiale Scryfall). Max 20 nomi.
  async autocomplete(query, signal) {
    const q = query.trim();
    if (q.length < 2) return [];
    const res = await fetch(`${this.API_BASE}/cards/autocomplete?q=${encodeURIComponent(q)}`, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  },

  // Immagine della carta nominata (fuzzy), per il token copia. null se non trovata.
  async namedCardImage(name, signal) {
    const res = await fetch(`${this.API_BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`, { signal });
    if (!res.ok) return null; // 404/400 = non trovata o ambigua
    return this.cardImage(await res.json());
  },

  // Ricerca token su Scryfall (per aggiungere token esterni al mazzo).
  async searchTokens(query, signal) {
    const q = `${query} t:token`;
    const url = `${this.API_BASE}/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name`;
    const res = await fetch(url, { signal });
    if (!res.ok) return []; // 404 = nessun risultato
    const data = await res.json();
    return (data.data || []).slice(0, 30).map(c => this.cardToToken(c));
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

    // Dedup per firma: token identici da stampe diverse -> una sola voce,
    // preferendo quella che ha un'immagine.
    const bySig = new Map();
    for (const c of tokenCards) {
      const sig = this.tokenSignature(c);
      const tok = this.cardToToken(c);
      const prev = bySig.get(sig);
      if (!prev || (!prev.image && tok.image)) bySig.set(sig, tok);
    }

    const tokens = [...bySig.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));

    return { tokens, cardCount: cards.length };
  }
};
