// app.js
// Collega l'interfaccia ai moduli Scryfall e Storage. Vanilla JS, nessun framework.

const els = {
  // import
  input: document.getElementById('decklist-input'),
  btnAnalyze: document.getElementById('btn-analyze'),
  btnClearInput: document.getElementById('btn-clear-input'),
  archidektId: document.getElementById('archidekt-id'),
  btnArchidekt: document.getElementById('btn-archidekt'),
  status: document.getElementById('status'),
  importView: document.getElementById('import-view'),
  // board
  boardView: document.getElementById('board-view'),
  inPlayList: document.getElementById('in-play-list'),
  btnAdd: document.getElementById('btn-add'),
  centerEmpty: document.getElementById('center-empty'),
  centerCard: document.getElementById('center-card'),
  centerImg: document.getElementById('center-img'),
  centerName: document.getElementById('center-name'),
  centerTotal: document.getElementById('center-total'),
  btnMinus: document.getElementById('btn-minus'),
  btnPlus: document.getElementById('btn-plus'),
  tapCol: document.getElementById('tap-col'),
  cellUntapped: document.getElementById('cell-untapped'),
  cellTapped: document.getElementById('cell-tapped'),
  numUntapped: document.getElementById('num-untapped'),
  numTapped: document.getElementById('num-tapped'),
  // overlay ricerca
  searchOverlay: document.getElementById('search-overlay'),
  searchInput: document.getElementById('search-input'),
  searchGrid: document.getElementById('search-grid'),
  searchClose: document.getElementById('search-close'),
  // segnalini
  counterCol: document.getElementById('counter-col'),
  counterList: document.getElementById('counter-list'),
  counterEmpty: document.getElementById('counter-empty'),
  btnAddCounter: document.getElementById('btn-add-counter'),
  counterModal: document.getElementById('counter-modal'),
  counterModalToken: document.getElementById('counter-modal-token'),
  counterPresets: document.getElementById('counter-presets'),
  counterCustom: document.getElementById('counter-custom'),
  counterCustomAdd: document.getElementById('counter-custom-add'),
  counterCancel: document.getElementById('counter-cancel'),
  // modali
  removeModal: document.getElementById('remove-modal'),
  rmUntapped: document.getElementById('rm-untapped'),
  rmTapped: document.getElementById('rm-tapped'),
  rmCancel: document.getElementById('rm-cancel'),
  btnMenu: document.getElementById('btn-menu'),
  menuSheet: document.getElementById('menu-sheet'),
  menuNewGame: document.getElementById('menu-new-game'),
  menuChangeDeck: document.getElementById('menu-change-deck'),
  menuClose: document.getElementById('menu-close')
};

let allTokens = [];   // tutti i token risolti dal mazzo
let selectedId = null; // token attualmente al centro

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}
function setBusy(busy) {
  els.btnAnalyze.disabled = busy;
  els.btnArchidekt.disabled = busy;
}

// --- parsing decklist ---
function parseDecklist(text) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//') && !l.startsWith('#'))
    .map(l => l.replace(/^\d+\s*x?\s+/i, '').split('(')[0].trim())
    .filter(Boolean);
}

// --- analisi mazzo ---
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
      return;
    }
    Storage.saveDeck(cardNames, tokens);
    enterBoard(tokens);
  } catch (err) {
    console.error(err);
    setStatus('Errore nel contattare Scryfall. Controlla la connessione e riprova.', true);
  } finally {
    setBusy(false);
  }
}

// --- passaggio alla board ---
function enterBoard(tokens) {
  allTokens = tokens;
  document.body.classList.add('board-active');
  els.boardView.hidden = false;
  selectedId = null;
  renderInPlay();
  renderCenter();
}

function tokenById(id) { return allTokens.find(t => t.id === id); }

// token attualmente in gioco (totale > 0)
function inPlayTokens() {
  return allTokens.filter(t => Storage.total(t.id) > 0);
}

function renderInPlay() {
  els.inPlayList.innerHTML = '';
  const playing = inPlayTokens();
  if (selectedId && !playing.some(t => t.id === selectedId)) {
    selectedId = playing.length ? playing[0].id : null;
  }
  playing.forEach(t => {
    const card = document.createElement('button');
    card.className = 'play-card' + (t.id === selectedId ? ' selected' : '');
    card.setAttribute('aria-label', t.name);
    if (t.image) {
      // il nome è già stampato sulla carta: basta l'immagine
      const img = document.createElement('img');
      img.loading = 'lazy'; img.alt = ''; img.src = t.image;
      card.appendChild(img);
    } else {
      const name = document.createElement('span');
      name.className = 'play-name';
      name.textContent = t.name;
      card.appendChild(name);
    }
    const badge = document.createElement('span');
    badge.className = 'play-badge';
    badge.textContent = Storage.total(t.id);
    card.appendChild(badge);
    card.addEventListener('click', () => { selectedId = t.id; renderInPlay(); renderCenter(); });
    els.inPlayList.appendChild(card);
  });
}

function renderCenter() {
  const t = selectedId ? tokenById(selectedId) : null;
  renderCounters(t);
  if (!t) {
    els.centerCard.hidden = true;
    els.centerEmpty.hidden = false;
    els.tapCol.hidden = true;
    return;
  }
  const e = Storage.getEntry(t.id);
  els.centerEmpty.hidden = true;
  els.centerCard.hidden = false;
  els.tapCol.hidden = false;
  els.centerName.textContent = t.name;
  els.centerName.hidden = Boolean(t.image); // il nome è già stampato sulla carta
  els.centerTotal.textContent = e.untapped + e.tapped;
  els.numUntapped.textContent = e.untapped;
  els.numTapped.textContent = e.tapped;
  if (t.image) { els.centerImg.src = t.image; els.centerImg.style.display = ''; }
  else { els.centerImg.style.display = 'none'; }
}

// --- contatore centrale ---
els.btnPlus.addEventListener('click', () => {
  if (!selectedId) return;
  Storage.addOne(selectedId);
  renderInPlay(); renderCenter();
});

els.btnMinus.addEventListener('click', () => {
  if (!selectedId) return;
  const e = Storage.getEntry(selectedId);
  if (e.untapped + e.tapped === 0) return;
  if (e.untapped > 0 && e.tapped > 0) {
    els.removeModal.hidden = false; // ambiguo: chiedi
  } else if (e.untapped > 0) {
    Storage.removeUntapped(selectedId); renderInPlay(); renderCenter();
  } else {
    Storage.removeTapped(selectedId); renderInPlay(); renderCenter();
  }
});

els.rmUntapped.addEventListener('click', () => {
  Storage.removeUntapped(selectedId); els.removeModal.hidden = true; renderInPlay(); renderCenter();
});
els.rmTapped.addEventListener('click', () => {
  Storage.removeTapped(selectedId); els.removeModal.hidden = true; renderInPlay(); renderCenter();
});
els.rmCancel.addEventListener('click', () => { els.removeModal.hidden = true; });

// --- segnalini del token selezionato ---
function renderCounters(t) {
  els.counterCol.hidden = !t;
  if (!t) return;
  const counters = Storage.getCounters(t.id);
  const names = Object.keys(counters).sort((a, b) => a.localeCompare(b));
  els.counterEmpty.hidden = names.length > 0;
  els.counterList.innerHTML = '';
  names.forEach(name => {
    const item = document.createElement('div');
    item.className = 'counter-item';

    const label = document.createElement('span');
    label.className = 'counter-name';
    label.textContent = name;
    label.title = name;

    const minus = document.createElement('button');
    minus.className = 'counter-step';
    minus.textContent = '−';
    minus.setAttribute('aria-label', `Togli un segnalino ${name}`);
    minus.addEventListener('click', () => {
      Storage.changeCounter(t.id, name, -1);
      renderCounters(t);
    });

    const qty = document.createElement('span');
    qty.className = 'counter-qty';
    qty.textContent = counters[name];

    const plus = document.createElement('button');
    plus.className = 'counter-step';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `Aggiungi un segnalino ${name}`);
    plus.addEventListener('click', () => {
      Storage.changeCounter(t.id, name, 1);
      renderCounters(t);
    });

    item.append(label, minus, qty, plus);
    els.counterList.appendChild(item);
  });
}

function openCounterModal() {
  const t = selectedId ? tokenById(selectedId) : null;
  if (!t) return;
  els.counterModalToken.textContent = t.name;
  els.counterCustom.value = '';
  els.counterModal.hidden = false;
}

function addCounterAndClose(name) {
  const trimmed = name.trim();
  if (!trimmed || !selectedId) return;
  Storage.changeCounter(selectedId, trimmed, 1);
  els.counterModal.hidden = true;
  renderCounters(tokenById(selectedId));
}

els.btnAddCounter.addEventListener('click', openCounterModal);
els.counterPresets.addEventListener('click', e => {
  const btn = e.target.closest('[data-counter]');
  if (btn) addCounterAndClose(btn.dataset.counter);
});
els.counterCustomAdd.addEventListener('click', () => addCounterAndClose(els.counterCustom.value));
els.counterCustom.addEventListener('keydown', e => {
  if (e.key === 'Enter') addCounterAndClose(els.counterCustom.value);
});
els.counterCancel.addEventListener('click', () => { els.counterModal.hidden = true; });

// --- tap / untap ---
els.cellUntapped.addEventListener('click', () => {
  if (!selectedId) return;
  Storage.tapOne(selectedId); renderCenter();
});
els.cellTapped.addEventListener('click', () => {
  if (!selectedId) return;
  Storage.untapOne(selectedId); renderCenter();
});

// --- overlay ricerca (aggiungi token dalla griglia del mazzo) ---
function openSearch() {
  els.searchInput.value = '';
  renderSearchGrid('');
  els.searchOverlay.hidden = false;
  els.searchInput.focus();
}
function renderSearchGrid(filter) {
  const q = filter.trim().toLowerCase();
  els.searchGrid.innerHTML = '';
  allTokens
    .filter(t => !q || t.name.toLowerCase().includes(q))
    .forEach(t => {
      const card = document.createElement('button');
      card.className = 'search-card';
      if (t.image) {
        const img = document.createElement('img');
        img.loading = 'lazy'; img.alt = t.name; img.src = t.image;
        card.appendChild(img);
      } else {
        const fb = document.createElement('div');
        fb.className = 'search-fallback'; fb.textContent = t.name;
        card.appendChild(fb);
      }
      card.addEventListener('click', () => {
        Storage.addOne(t.id);      // entra con totale 1, stappato
        selectedId = t.id;
        els.searchOverlay.hidden = true;
        renderInPlay(); renderCenter();
      });
      els.searchGrid.appendChild(card);
    });
}
els.btnAdd.addEventListener('click', openSearch);
els.searchInput.addEventListener('input', e => renderSearchGrid(e.target.value));
els.searchClose.addEventListener('click', () => { els.searchOverlay.hidden = true; });

// --- menu ---
els.btnMenu.addEventListener('click', () => { els.menuSheet.hidden = false; });
els.menuClose.addEventListener('click', () => { els.menuSheet.hidden = true; });
els.menuNewGame.addEventListener('click', () => {
  Storage.resetState(); els.menuSheet.hidden = true; selectedId = null; renderInPlay(); renderCenter();
});
els.menuChangeDeck.addEventListener('click', () => {
  Storage.clearDeck();
  els.menuSheet.hidden = true;
  document.body.classList.remove('board-active');
  els.boardView.hidden = true;
  els.input.value = '';
  setStatus('Mazzo rimosso. Incolla una nuova decklist per continuare.');
});

// --- import handlers ---
els.btnAnalyze.addEventListener('click', () => analyzeDeck(parseDecklist(els.input.value)));
els.btnClearInput.addEventListener('click', () => { els.input.value = ''; setStatus(''); });

async function importFromArchidekt(deckId) {
  setBusy(true);
  setStatus('Provo a importare il mazzo da Archidekt...');
  try {
    const res = await fetch(`https://archidekt.com/api/decks/${deckId}/`);
    if (!res.ok) throw new Error(`Archidekt errore ${res.status}`);
    const data = await res.json();
    const cardNames = (data.cards || []).map(c => c.card?.oracleCard?.name).filter(Boolean);
    if (cardNames.length === 0) throw new Error('Nessuna carta trovata.');
    els.input.value = cardNames.join('\n');
    await analyzeDeck(cardNames);
  } catch (err) {
    console.error(err);
    setStatus('Import da Archidekt non riuscito (probabile blocco CORS). Copia la decklist e incollala sopra.', true);
  } finally {
    setBusy(false);
  }
}
els.btnArchidekt.addEventListener('click', () => {
  const id = els.archidektId.value.trim();
  if (!id) { setStatus('Inserisci un ID mazzo Archidekt.', true); return; }
  importFromArchidekt(id);
});

// --- ripristino sessione ---
(function init() {
  const deck = Storage.loadDeck();
  if (deck && deck.tokens.length > 0) {
    els.input.value = deck.cardNames.join('\n');
    enterBoard(deck.tokens);
  }
})();

// --- service worker ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW non registrato:', err));
  });
}
