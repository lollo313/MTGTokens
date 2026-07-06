// app.js
// Collega l'interfaccia ai moduli Scryfall e Storage. Nessun framework:
// tutto vanilla JS, così il progetto resta leggero e facile da hostare come file statici.

const els = {
  input: document.getElementById('decklist-input'),
  btnAnalyze: document.getElementById('btn-analyze'),
  btnClearInput: document.getElementById('btn-clear-input'),
  archidektId: document.getElementById('archidekt-id'),
  btnArchidekt: document.getElementById('btn-archidekt'),
  status: document.getElementById('status'),
  tokensPanel: document.getElementById('tokens-panel'),
  tokenGrid: document.getElementById('token-grid'),
  emptyState: document.getElementById('empty-state'),
  btnNewGame: document.getElementById('btn-new-game'),
  btnChangeDeck: document.getElementById('btn-change-deck')
};

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

function setBusy(busy) {
  els.btnAnalyze.disabled = busy;
  els.btnArchidekt.disabled = busy;
}

// Estrae i nomi carta da una decklist testuale in formati comuni:
// "4 Lightning Bolt", "4x Lightning Bolt", "Lightning Bolt",
// "1 Lightning Bolt (LEA) 162". Ignora righe vuote e commenti (// oppure #).
function parseDecklist(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('//') && !line.startsWith('#'))
    .map(line => {
      let cleaned = line.replace(/^\d+\s*x?\s+/i, ''); // rimuove quantità iniziale
      cleaned = cleaned.split('(')[0].trim();           // rimuove "(SET) 123" finale
      return cleaned;
    })
    .filter(Boolean);
}

async function analyzeDeck(cardNames) {
  if (cardNames.length === 0) {
    setStatus('Non ho trovato nomi di carte validi nel testo incollato.', true);
    return;
  }
  setBusy(true);
  setStatus(`Interrogo Scryfall per ${cardNames.length} carte...`);
  try {
    const { tokens, cardCount } = await Scryfall.resolveTokensForDeck(cardNames);
    if (tokens.length === 0) {
      setStatus(`Analizzate ${cardCount ?? cardNames.length} carte: nessun token generato da questo mazzo.`);
      Storage.saveDeck(cardNames, []);
      renderTokens([]);
      return;
    }
    Storage.saveDeck(cardNames, tokens);
    renderTokens(tokens, Storage.loadDeck().counts);
    setStatus(`Pronto: trovati ${tokens.length} tipi di token da ${cardCount ?? cardNames.length} carte.`);
  } catch (err) {
    console.error(err);
    setStatus('Errore nel contattare Scryfall. Controlla la connessione e riprova.', true);
  } finally {
    setBusy(false);
  }
}

function renderTokens(tokens, counts = {}) {
  els.tokenGrid.innerHTML = '';
  const hasTokens = tokens.length > 0;
  els.tokensPanel.hidden = !hasTokens;
  els.emptyState.hidden = hasTokens;
  els.btnNewGame.hidden = !hasTokens;
  els.btnChangeDeck.hidden = !hasTokens;

  tokens.forEach(token => {
    const card = document.createElement('article');
    card.className = 'token-card';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = token.name;
    img.src = token.image || '';
    if (!token.image) img.style.display = 'none';
    card.appendChild(img);

    const info = document.createElement('div');
    info.className = 'info';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = token.name;
    info.appendChild(name);

    const counter = document.createElement('div');
    counter.className = 'counter';

    const minus = document.createElement('button');
    minus.textContent = '−';
    minus.setAttribute('aria-label', `Diminuisci ${token.name}`);

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = counts[token.id] ?? 0;

    const plus = document.createElement('button');
    plus.textContent = '+';
    plus.setAttribute('aria-label', `Aumenta ${token.name}`);

    minus.addEventListener('click', () => {
      const newVal = Storage.setCount(token.id, parseInt(count.textContent, 10) - 1);
      count.textContent = newVal;
    });
    plus.addEventListener('click', () => {
      const newVal = Storage.setCount(token.id, parseInt(count.textContent, 10) + 1);
      count.textContent = newVal;
    });

    counter.append(minus, count, plus);
    info.appendChild(counter);
    card.appendChild(info);
    els.tokenGrid.appendChild(card);
  });
}

// Best-effort: prova a leggere un mazzo pubblico direttamente dall'API di Archidekt.
// L'endpoint non è documentato ufficialmente e potrebbe rifiutare richieste
// cross-origin dal browser (CORS): in quel caso mostriamo un messaggio chiaro
// e l'utente può sempre incollare la decklist a mano.
async function importFromArchidekt(deckId) {
  setBusy(true);
  setStatus('Provo a importare il mazzo da Archidekt...');
  try {
    const res = await fetch(`https://archidekt.com/api/decks/${deckId}/`);
    if (!res.ok) throw new Error(`Archidekt ha risposto con errore ${res.status}`);
    const data = await res.json();
    const cardNames = (data.cards || [])
      .map(c => c.card?.oracleCard?.name)
      .filter(Boolean);
    if (cardNames.length === 0) throw new Error('Nessuna carta trovata nella risposta di Archidekt.');
    els.input.value = cardNames.join('\n');
    await analyzeDeck(cardNames);
  } catch (err) {
    console.error(err);
    setStatus(
      'Import da Archidekt non riuscito (probabile blocco CORS del browser). Copia la decklist da Archidekt e incollala nel campo di testo sopra.',
      true
    );
  } finally {
    setBusy(false);
  }
}

els.btnAnalyze.addEventListener('click', () => {
  const cardNames = parseDecklist(els.input.value);
  analyzeDeck(cardNames);
});

els.btnClearInput.addEventListener('click', () => {
  els.input.value = '';
  setStatus('');
});

els.btnArchidekt.addEventListener('click', () => {
  const id = els.archidektId.value.trim();
  if (!id) {
    setStatus('Inserisci un ID di mazzo Archidekt (il numero nel link del mazzo).', true);
    return;
  }
  importFromArchidekt(id);
});

els.btnNewGame.addEventListener('click', () => {
  Storage.resetCounts();
  const deck = Storage.loadDeck();
  renderTokens(deck.tokens, deck.counts);
  setStatus('Contatori azzerati per una nuova partita.');
});

els.btnChangeDeck.addEventListener('click', () => {
  Storage.clearDeck();
  els.input.value = '';
  renderTokens([]);
  setStatus('Mazzo rimosso. Incolla una nuova decklist per continuare.');
});

// Al caricamento, ripristina l'ultimo mazzo analizzato (se presente) così
// non serve rifare l'analisi ogni volta che riapri l'app durante la partita.
(function init() {
  const deck = Storage.loadDeck();
  if (deck && deck.tokens.length > 0) {
    els.input.value = deck.cardNames.join('\n');
    renderTokens(deck.tokens, deck.counts);
    setStatus('Mazzo precedente ripristinato.');
  }
})();

// Registrazione del service worker per il funzionamento offline.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW non registrato:', err));
  });
}
