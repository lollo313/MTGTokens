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
  centerCopyLabel: document.getElementById('center-copy-label'),
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
  searchModeDeck: document.getElementById('search-mode-deck'),
  searchModeScryfall: document.getElementById('search-mode-scryfall'),
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

const REDUCE_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Dissolvenza incrociata: solo quando il token mostrato cambia davvero
// (non su tap, contatori o istanze dello stesso token, che restano istantanei).
function crossfade(el, timerKey, newId, lastId, apply) {
  const isSwitch = lastId !== undefined && lastId !== null && newId !== null && newId !== lastId;
  if (!isSwitch || REDUCE_MOTION) { apply(); return; }
  clearTimeout(crossfade.timers[timerKey]);
  el.classList.add('fade-out');
  crossfade.timers[timerKey] = setTimeout(() => {
    apply();
    el.classList.remove('fade-out');
  }, 150);
}
crossfade.timers = {};

let lastCenterTokenId; // undefined finché non c'è stato un primo render
let lastTrayTokenId;

// id di una copia appena creata da mettere a fuoco per l'etichetta
let pendingFocusCopy = null;

// --- token copia: ogni copia è una riga a sé con etichetta modificabile ---
function newCopyId() {
  return (self.crypto && crypto.randomUUID)
    ? 'copy-' + crypto.randomUUID()
    : 'copy-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

// Crea una nuova entità copia clonando il token base, con un'istanza in gioco.
function createCopyEntry(base) {
  const entry = {
    id: newCopyId(),
    name: base.name,
    image: base.image,
    baseImage: base.image, // arte del token Copy, ripristinata se l'etichetta è vuota
    typeLine: base.typeLine,
    oracleText: base.oracleText,
    isCopy: true,
    dynamic: true, // creata a runtime: fuori dalla ricerca, azzerata a nuova partita
    label: ''
  };
  allTokens.push(entry);
  Storage.saveTokens(allTokens);
  Storage.addOne(entry.id);
  return entry;
}

function isCopyEntry(t) { return Boolean(t && t.dynamic && t.isCopy); }

// Fetch (con debounce) dell'immagine della carta copiata, applicata alla copia.
let copyImgTimer = null;
let copyImgSeq = 0;
let copyImgController = null;

function scheduleCopyImageFetch(entry) {
  clearTimeout(copyImgTimer);
  const label = entry.label.trim();
  if (!label) {
    // etichetta vuota: torna all'arte del token Copy
    if (entry.image !== entry.baseImage) {
      entry.image = entry.baseImage;
      Storage.saveTokens(allTokens);
      if (selectedId === entry.id) renderBoard();
    }
    return;
  }
  copyImgTimer = setTimeout(async () => {
    const seq = ++copyImgSeq;
    if (copyImgController) copyImgController.abort();
    copyImgController = new AbortController();
    try {
      const img = await Scryfall.namedCardImage(label, copyImgController.signal);
      if (seq !== copyImgSeq) return;         // richiesta superata da una più recente
      const target = img || entry.baseImage;  // non trovata: ripiega sull'arte del Copy
      if (target !== entry.image) {
        entry.image = target;
        Storage.saveTokens(allTokens);
        if (selectedId === entry.id) renderBoard();
      }
    } catch (e) { /* abort o rete: mantieni l'immagine attuale */ }
  }, 500);
}

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

    // etichetta della copia sopra la fascia titolo, per distinguere le copie
    if (isCopyEntry(t)) {
      const cap = document.createElement('span');
      cap.className = 'play-copy-label';
      cap.textContent = t.label || 'Copia';
      card.appendChild(cap);
      card.setAttribute('aria-label', t.label ? `Copia: ${t.label}` : 'Copia senza nome');
    }

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
  const newId = t ? t.id : null;

  const apply = () => {
    if (!t) {
      els.centerCard.hidden = true;
      els.centerEmpty.hidden = false;
    } else {
      els.centerEmpty.hidden = true;
      els.centerCard.hidden = false;
      els.centerName.textContent = t.name;
      els.centerName.hidden = Boolean(t.image); // il nome è già stampato sulla carta
      els.centerCount.textContent = Storage.total(t.id);
      if (t.image) { els.centerImg.src = t.image; els.centerImg.style.display = ''; }
      else { els.centerImg.style.display = 'none'; }

      const copy = isCopyEntry(t);
      els.centerCopyLabel.hidden = !copy;
      // non sovrascrivere mentre l'utente sta digitando
      if (copy && document.activeElement !== els.centerCopyLabel) {
        els.centerCopyLabel.value = t.label || '';
      }
      if (copy && pendingFocusCopy === t.id) {
        pendingFocusCopy = null;
        els.centerCopyLabel.focus();
      }
    }
    lastCenterTokenId = newId;
  };

  crossfade(els.centerCard, 'center', newId, lastCenterTokenId, apply);
}

// --- tray: una mini-carta per istanza ---
function renderTray() {
  const t = selectedId ? tokenById(selectedId) : null;
  els.tray.hidden = !t;
  const newId = t ? t.id : null;
  if (!t) { lastTrayTokenId = null; return; }

  const apply = () => {
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
    lastTrayTokenId = newId;
  };

  crossfade(els.trayGrid, 'tray', newId, lastTrayTokenId, apply);
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

// --- overlay ricerca: token del mazzo oppure ricerca su Scryfall ---
let searchMode = 'deck'; // 'deck' | 'scryfall'
let scryfallTimer = null;
let scryfallSeq = 0;
let scryfallController = null;

function openSearch() {
  els.searchInput.value = '';
  els.searchOverlay.hidden = false;
  setSearchMode('deck');
  // con la barra in alto la tastiera in landscape non copre più la scelta
  els.searchInput.focus();
}

function closeSearch() {
  clearTimeout(scryfallTimer);
  if (scryfallController) scryfallController.abort();
  els.searchOverlay.hidden = true;
}

function setSearchMode(mode) {
  searchMode = mode;
  els.searchModeDeck.classList.toggle('active', mode === 'deck');
  els.searchModeScryfall.classList.toggle('active', mode === 'scryfall');
  els.searchInput.placeholder = mode === 'scryfall' ? 'Cerca su Scryfall…' : 'Cerca';
  runSearch(els.searchInput.value);
}

function runSearch(value) {
  if (searchMode === 'deck') renderDeckResults(value);
  else scheduleScryfallSearch(value);
}

// costruisce una card di risultato con l'azione al click
function buildResultCard(t, onPick) {
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
  card.addEventListener('click', onPick);
  return card;
}

function searchMessage(text) {
  els.searchGrid.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'search-msg';
  msg.textContent = text;
  els.searchGrid.appendChild(msg);
}

// aggiunge/seleziona un token; i token copia diventano un'entità etichettabile
function pickToken(t, { persistNew = false } = {}) {
  if (t.isCopy) {
    const entry = createCopyEntry(t);
    selectedId = entry.id;
    pendingFocusCopy = entry.id;
  } else {
    let entry = tokenById(t.id);
    if (!entry) {
      entry = { ...t };
      if (persistNew) entry.added = true; // token esterno aggiunto da Scryfall
      allTokens.push(entry);
      Storage.saveTokens(allTokens);
    }
    Storage.addOne(entry.id);
    selectedId = entry.id;
  }
  closeSearch();
  renderBoard();
}

function renderDeckResults(filter) {
  const q = filter.trim().toLowerCase();
  els.searchGrid.innerHTML = '';
  // le copie create a runtime non sono "token del mazzo": fuori dalla ricerca
  const list = allTokens.filter(t => !t.dynamic && (!q || t.name.toLowerCase().includes(q)));
  if (list.length === 0) { searchMessage('Nessun token nel mazzo'); return; }
  list.forEach(t => els.searchGrid.appendChild(buildResultCard(t, () => pickToken(t))));
}

function scheduleScryfallSearch(value) {
  clearTimeout(scryfallTimer);
  const q = value.trim();
  if (q.length < 2) { searchMessage('Digita per cercare token su Scryfall'); return; }
  searchMessage('Cerco…');
  scryfallTimer = setTimeout(async () => {
    const seq = ++scryfallSeq;
    if (scryfallController) scryfallController.abort();
    scryfallController = new AbortController();
    try {
      const results = await Scryfall.searchTokens(q, scryfallController.signal);
      if (seq !== scryfallSeq) return; // superata da una richiesta più recente
      if (results.length === 0) { searchMessage('Nessun token trovato'); return; }
      els.searchGrid.innerHTML = '';
      results.forEach(t => els.searchGrid.appendChild(
        buildResultCard(t, () => pickToken(t, { persistNew: true }))));
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (seq === scryfallSeq) searchMessage('Ricerca non riuscita. Riprova.');
    }
  }, 450);
}

els.btnAdd.addEventListener('click', openSearch);
els.searchInput.addEventListener('input', e => runSearch(e.target.value));
els.searchModeDeck.addEventListener('click', () => setSearchMode('deck'));
els.searchModeScryfall.addEventListener('click', () => setSearchMode('scryfall'));
els.searchClose.addEventListener('click', closeSearch);

// --- etichetta della copia (campo di testo sulla carta centrale) ---
els.centerCopyLabel.addEventListener('input', () => {
  const t = selectedId ? tokenById(selectedId) : null;
  if (!isCopyEntry(t)) return;
  t.label = els.centerCopyLabel.value;
  Storage.saveTokens(allTokens);
  // aggiorna la sola riga selezionata senza ricostruire (non perde il focus)
  const cap = els.stack.querySelector('.play-card.selected .play-copy-label');
  if (cap) cap.textContent = t.label || 'Copia';
  const card = els.stack.querySelector('.play-card.selected');
  if (card) card.setAttribute('aria-label', t.label ? `Copia: ${t.label}` : 'Copia senza nome');
  // cerca l'immagine della carta copiata (con debounce)
  scheduleCopyImageFetch(t);
});
els.centerCopyLabel.addEventListener('keydown', e => {
  if (e.key === 'Enter') els.centerCopyLabel.blur();
});

// --- menu ---
els.btnMenu.addEventListener('click', () => { els.menuSheet.hidden = false; });
els.menuClose.addEventListener('click', () => { els.menuSheet.hidden = true; });
els.menuNewGame.addEventListener('click', () => {
  Storage.resetState();
  // le copie etichettate erano specifiche di quella partita: via
  allTokens = allTokens.filter(t => !t.dynamic);
  Storage.saveTokens(allTokens);
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
// In locale niente cache offline: servirebbe sempre la versione precedente
// e nasconderebbe le modifiche durante lo sviluppo.
if ('serviceWorker' in navigator) {
  const isDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  window.addEventListener('load', () => {
    if (isDev) {
      navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    } else {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW non registrato:', err));
    }
  });
}
