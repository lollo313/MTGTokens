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
  stack: document.getElementById('stack'),
  btnAdd: document.getElementById('btn-add'),
  centerEmpty: document.getElementById('center-empty'),
  centerCard: document.getElementById('center-card'),
  centerImg: document.getElementById('center-img'),
  centerName: document.getElementById('center-name'),
  centerCount: document.getElementById('center-count'),
  // tray
  tray: document.getElementById('tray'),
  trayGrid: document.getElementById('tray-grid'),
  trayHeaderNormal: document.getElementById('tray-header-normal'),
  trayHeaderSelect: document.getElementById('tray-header-select'),
  btnAddCounter: document.getElementById('btn-add-counter'),
  btnClearCounters: document.getElementById('btn-clear-counters'),
  btnInstPlus: document.getElementById('btn-inst-plus'),
  btnInstMinus: document.getElementById('btn-inst-minus'),
  btnSelectDone: document.getElementById('btn-select-done'),
  boardScrim: document.getElementById('board-scrim'),
  // editor segnalini
  counterEditor: document.getElementById('counter-editor'),
  pwNum: document.getElementById('pw-num'),
  tgNum: document.getElementById('tg-num'),
  pwPlus: document.getElementById('pw-plus'),
  pwMinus: document.getElementById('pw-minus'),
  tgPlus: document.getElementById('tg-plus'),
  tgMinus: document.getElementById('tg-minus'),
  // overlay ricerca
  searchOverlay: document.getElementById('search-overlay'),
  searchInput: document.getElementById('search-input'),
  searchGrid: document.getElementById('search-grid'),
  searchClose: document.getElementById('search-close'),
  // menu
  btnMenu: document.getElementById('btn-menu'),
  menuSheet: document.getElementById('menu-sheet'),
  menuNewGame: document.getElementById('menu-new-game'),
  menuChangeDeck: document.getElementById('menu-change-deck'),
  menuClose: document.getElementById('menu-close')
};

let allTokens = [];    // tutti i token risolti dal mazzo
let selectedId = null; // token attualmente al centro

// Modalità selezione multipla sul tray:
// null | 'counter' (applica segnalino) | 'remove' (rimuovi istanze) | 'clear' (togli segnalini)
let selectMode = null;
let selectedInstances = new Set();

// Editor forza/costituzione: { dp, dt, targets: [indici], replace: bool } | null
let editor = null;

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
  renderBoard();
}

function tokenById(id) { return allTokens.find(t => t.id === id); }

// token attualmente in gioco (almeno un'istanza)
function inPlayTokens() {
  return allTokens.filter(t => Storage.total(t.id) > 0);
}

function fmtMod(n) { return (n >= 0 ? '+' : '') + n; }

function renderBoard() {
  renderStack();
  renderCenter();
  renderTray();
}

// --- colonna sinistra: pila delle fasce titolo ---
function renderStack() {
  els.stack.innerHTML = '';
  const playing = inPlayTokens();
  if (!playing.some(t => t.id === selectedId)) {
    selectedId = playing.length ? playing[0].id : null;
  }
  playing.forEach(t => {
    const card = document.createElement('button');
    card.className = 'play-card' + (t.id === selectedId ? ' selected' : '');
    card.setAttribute('aria-label', t.name);

    const face = document.createElement('span');
    face.className = 'play-face';
    if (t.image) {
      // il nome è già stampato sulla fascia titolo della carta
      const img = document.createElement('img');
      img.loading = 'lazy'; img.alt = ''; img.src = t.image;
      face.appendChild(img);
    } else {
      const name = document.createElement('span');
      name.className = 'play-name';
      name.textContent = t.name;
      face.appendChild(name);
    }
    card.appendChild(face);

    const badge = document.createElement('span');
    badge.className = 'play-badge';
    badge.textContent = Storage.total(t.id);
    card.appendChild(badge);

    card.addEventListener('click', () => {
      if (selectMode) return; // durante la selezione la pila è sotto lo scrim
      selectedId = t.id;
      renderBoard();
    });
    els.stack.appendChild(card);
  });
}

// --- carta selezionata al centro ---
function renderCenter() {
  const t = selectedId ? tokenById(selectedId) : null;
  if (!t) {
    els.centerCard.hidden = true;
    els.centerEmpty.hidden = false;
    return;
  }
  els.centerEmpty.hidden = true;
  els.centerCard.hidden = false;
  els.centerName.textContent = t.name;
  els.centerName.hidden = Boolean(t.image); // il nome è già stampato sulla carta
  els.centerCount.textContent = Storage.total(t.id);
  if (t.image) { els.centerImg.src = t.image; els.centerImg.style.display = ''; }
  else { els.centerImg.style.display = 'none'; }
}

// --- tray: una mini-carta per istanza ---
function renderTray() {
  const t = selectedId ? tokenById(selectedId) : null;
  els.tray.hidden = !t;
  if (!t) return;

  const instances = Storage.getInstances(t.id);

  els.trayHeaderNormal.hidden = Boolean(selectMode);
  els.trayHeaderSelect.hidden = !selectMode;
  els.btnClearCounters.hidden = Boolean(selectMode) || !instances.some(i => i.p || i.t);

  els.trayGrid.innerHTML = '';
  instances.forEach((inst, i) => {
    const mini = document.createElement('button');
    mini.className = 'mini'
      + (inst.tapped ? ' tapped' : '')
      + (selectedInstances.has(i) ? ' selected' : '');
    mini.dataset.index = i;
    mini.setAttribute('aria-label', inst.tapped
      ? `${t.name} tappato: tocca per stappare`
      : `${t.name} stappato: tocca per tappare`);

    const face = document.createElement('span');
    face.className = inst.tapped ? 'mini-rot' : 'mini-face';
    if (t.image) {
      const img = document.createElement('img');
      img.loading = 'lazy'; img.alt = ''; img.src = t.image;
      face.appendChild(img);
    }
    mini.appendChild(face);

    if (inst.p || inst.t) {
      const badge = document.createElement('span');
      badge.className = 'mini-badge';
      badge.dataset.badge = '1';
      badge.textContent = `${fmtMod(inst.p)}/${fmtMod(inst.t)}`;
      mini.appendChild(badge);
    }
    els.trayGrid.appendChild(mini);
  });
}

// tocco su una mini: tap/untap, oppure selezione in modalità selezione;
// tocco sul badge: modifica mirata del segnalino di quella istanza.
els.trayGrid.addEventListener('click', e => {
  const mini = e.target.closest('.mini');
  if (!mini || !selectedId) return;
  const i = Number(mini.dataset.index);

  if (selectMode) {
    if (selectedInstances.has(i)) selectedInstances.delete(i);
    else selectedInstances.add(i);
    renderTray();
    return;
  }

  if (e.target.closest('[data-badge]')) {
    const inst = Storage.getInstances(selectedId)[i];
    openEditor({ dp: inst.p, dt: inst.t, targets: [i], replace: true });
    return;
  }

  Storage.toggleTap(selectedId, i);
  renderTray();
});

// --- modalità selezione multipla ---
function enterSelectMode(mode) {
  if (!selectedId) return;
  selectMode = mode;
  selectedInstances = new Set();
  els.boardView.classList.add('selecting');
  els.boardScrim.hidden = false;
  renderTray();
}

function exitSelectMode() {
  selectMode = null;
  selectedInstances = new Set();
  els.boardView.classList.remove('selecting');
  els.boardScrim.hidden = true;
  renderBoard();
}

els.btnSelectDone.addEventListener('click', () => {
  if (!selectedId) { exitSelectMode(); return; }
  const chosen = [...selectedInstances];
  if (chosen.length === 0) { exitSelectMode(); return; }

  if (selectMode === 'counter') {
    // il tray resta in selezione sotto l'editor, come nel design
    openEditor({ dp: 0, dt: 0, targets: chosen, replace: false });
  } else if (selectMode === 'remove') {
    Storage.removeAt(selectedId, chosen);
    exitSelectMode();
  } else if (selectMode === 'clear') {
    Storage.clearCounters(selectedId, chosen);
    exitSelectMode();
  }
});

els.boardScrim.addEventListener('click', exitSelectMode);

// --- header del tray ---
els.btnInstPlus.addEventListener('click', () => {
  if (!selectedId) return;
  Storage.addOne(selectedId);
  renderBoard();
});

els.btnInstMinus.addEventListener('click', () => {
  if (!selectedId) return;
  const instances = Storage.getInstances(selectedId);
  if (instances.length === 0) return;
  const first = instances[0];
  const allSame = instances.every(i =>
    i.tapped === first.tapped && i.p === first.p && i.t === first.t);
  if (allSame) {
    Storage.removeAt(selectedId, [instances.length - 1]);
    renderBoard();
  } else {
    enterSelectMode('remove');
  }
});

els.btnAddCounter.addEventListener('click', () => enterSelectMode('counter'));
els.btnClearCounters.addEventListener('click', () => enterSelectMode('clear'));

// --- editor segnalini forza/costituzione ---
function openEditor(config) {
  editor = config;
  renderEditor();
  els.counterEditor.hidden = false;
}

function renderEditor() {
  els.pwNum.textContent = fmtMod(editor.dp);
  els.tgNum.textContent = fmtMod(editor.dt);
}

els.pwPlus.addEventListener('click', () => { editor.dp++; renderEditor(); });
els.pwMinus.addEventListener('click', () => { editor.dp--; renderEditor(); });
els.tgPlus.addEventListener('click', () => { editor.dt++; renderEditor(); });
els.tgMinus.addEventListener('click', () => { editor.dt--; renderEditor(); });

function applyEditor() {
  if (!editor || !selectedId) { closeEditor(); return; }
  Storage.applyCounter(selectedId, editor.targets, editor.dp, editor.dt, editor.replace);
  closeEditor();
}

function closeEditor() {
  editor = null;
  els.counterEditor.hidden = true;
  if (selectMode) exitSelectMode();
  else renderBoard();
}

// tocco fuori dal riquadro = applica (il design non prevede un bottone di conferma)
els.counterEditor.addEventListener('click', e => {
  if (e.target === els.counterEditor) applyEditor();
});

// Escape: annulla l'editor senza applicare, oppure esce dalla selezione
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!els.counterEditor.hidden) { closeEditor(); return; }
  if (selectMode) exitSelectMode();
});

// --- overlay ricerca (aggiungi token dalla griglia del mazzo) ---
function openSearch() {
  els.searchInput.value = '';
  renderSearchGrid('');
  els.searchOverlay.hidden = false;
  // con la barra in alto la tastiera in landscape non copre più la scelta
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
        Storage.addOne(t.id);      // entra con un'istanza stappata
        selectedId = t.id;
        els.searchOverlay.hidden = true;
        renderBoard();
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
  Storage.resetState();
  els.menuSheet.hidden = true;
  selectedId = null;
  if (selectMode) exitSelectMode();
  else renderBoard();
});
els.menuChangeDeck.addEventListener('click', () => {
  Storage.clearDeck();
  els.menuSheet.hidden = true;
  if (selectMode) exitSelectMode();
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
