// app.js
// Collega l'interfaccia ai moduli Scryfall e Storage. Vanilla JS, nessun framework.

const els = {
  // import
  deckTitle: document.getElementById('deck-title'),
  input: document.getElementById('decklist-input'),
  btnAnalyze: document.getElementById('btn-analyze'),
  btnClearInput: document.getElementById('btn-clear-input'),
  status: document.getElementById('status'),
  importView: document.getElementById('import-view'),
  // ultimi mazzi
  recentList: document.getElementById('recent-list'),
  recentEmpty: document.getElementById('recent-empty'),
  btnClearRecent: document.getElementById('btn-clear-recent'),
  confirmClear: document.getElementById('confirm-clear-recent'),
  confirmClearYes: document.getElementById('confirm-clear-yes'),
  confirmClearNo: document.getElementById('confirm-clear-no'),
  // board
  boardView: document.getElementById('board-view'),
  grid: document.getElementById('grid'),
  gridScroll: document.getElementById('grid-scroll'),
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
  copyField: document.getElementById('copy-field'),
  copyLabel: document.getElementById('copy-label'),
  copySuggest: document.getElementById('copy-suggest'),
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
  boardControls: document.querySelector('.board-controls'),
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

let lastTrayTokenId; // undefined finché non c'è stato un primo render del tray

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
    const title = els.deckTitle.value.trim();
    Storage.saveDeck(cardNames, tokens, title);
    Storage.saveRecentDeck(title, cardNames, tokens);
    renderRecents();
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
  dedupeLoadedTokens(); // mazzi vecchi/salvati: collassa i token duplicati
  document.body.classList.add('board-active');
  els.boardView.hidden = false;
  selectedId = null;
  renderBoard();
}

// firma di equivalenza di un token (stessa di Scryfall, sui campi del token).
// I mazzi vecchi non hanno forza/costituzione/colori salvati: lì i campi
// mancanti valgono '' e il dedup ricade su nome + tipo + testo.
function tokenSig(t) {
  return [
    (t.name || '').toLowerCase().trim(),
    (t.typeLine || '').toLowerCase().trim(),
    t.power ?? '',
    t.toughness ?? '',
    (t.colors || []).slice().sort().join(''),
    (t.oracleText || '').toLowerCase().trim()
  ].join('|');
}

// Collassa i token duplicati già in allTokens (stampe diverse dello stesso
// token), migrando le istanze in gioco sul sopravvissuto. Le copie dinamiche
// (etichettabili) restano sempre distinte.
function dedupeLoadedTokens() {
  const keepBySig = new Map();
  const survivors = [];
  let changed = false;
  for (const t of allTokens) {
    if (t.dynamic) { survivors.push(t); continue; }
    const sig = tokenSig(t);
    const keep = keepBySig.get(sig);
    if (!keep) {
      keepBySig.set(sig, t);
      survivors.push(t);
    } else {
      Storage.mergeInstances(t.id, keep.id);
      if (!keep.image && t.image) keep.image = t.image;
      changed = true;
    }
  }
  if (changed) {
    allTokens = survivors;
    Storage.saveTokens(allTokens);
  }
}

function tokenById(id) { return allTokens.find(t => t.id === id); }

// token attualmente in gioco (almeno un'istanza)
function inPlayTokens() {
  return allTokens.filter(t => Storage.total(t.id) > 0);
}

function fmtMod(n) { return (n >= 0 ? '+' : '') + n; }

function renderBoard() {
  renderGrid();
  renderTray();
}

// --- griglia dei token in gioco ---
// Per ogni token una card (fronte = istanze stappate, carta girata dietro =
// tappate, con i due conteggi); in coda la tessera "+" per aggiungere token.
// Toccare una card la seleziona e ne popola il tray.
function renderGrid() {
  const playing = inPlayTokens();
  if (!playing.some(t => t.id === selectedId)) {
    selectedId = playing.length ? playing[0].id : null;
  }
  els.gridScroll.innerHTML = '';
  playing.forEach(t => els.gridScroll.appendChild(buildGridCard(t)));

  const add = document.createElement('button');
  add.className = 'grid-add';
  add.dataset.add = '1';
  add.setAttribute('aria-label', 'Aggiungi token');
  add.innerHTML = '<span class="grid-add-box"><svg viewBox="0 0 12 12" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M6.93555 5.43555H12V6.93555H6.93555V12H5.43555V6.93555H0V5.43555H5.43555V0H6.93555V5.43555Z"/></svg></span>';
  els.gridScroll.appendChild(add);
}

function buildGridCard(t) {
  const instances = Storage.getInstances(t.id);
  const tapped = instances.filter(i => i.tapped).length;
  const untapped = instances.length - tapped;

  const card = document.createElement('button');
  card.className = 'grid-card' + (t.id === selectedId ? ' selected' : '');
  card.dataset.id = t.id;
  card.setAttribute('aria-label', isCopyEntry(t)
    ? (t.label ? `Copia: ${t.label}` : 'Copia senza nome')
    : t.name);

  // carta girata (tappate), dietro a destra
  const spine = document.createElement('span');
  spine.className = 'grid-spine';
  const spineInner = document.createElement('span');
  spineInner.className = 'grid-spine-inner';
  if (t.image) {
    const si = document.createElement('img');
    si.loading = 'lazy'; si.alt = ''; si.src = t.image;
    spineInner.appendChild(si);
  }
  spine.appendChild(spineInner);
  const tapCount = document.createElement('span');
  tapCount.className = 'grid-count grid-count-tap';
  tapCount.textContent = tapped;
  spine.appendChild(tapCount);
  card.appendChild(spine);

  // fronte (stappate), davanti a sinistra
  const face = document.createElement('span');
  face.className = 'grid-face';
  if (t.image) {
    const fi = document.createElement('img');
    fi.loading = 'lazy'; fi.alt = ''; fi.src = t.image;
    face.appendChild(fi);
  } else {
    const fb = document.createElement('span');
    fb.className = 'grid-fallback';
    fb.textContent = t.name;
    face.appendChild(fb);
  }
  const upCount = document.createElement('span');
  upCount.className = 'grid-count';
  upCount.textContent = untapped;
  face.appendChild(upCount);
  card.appendChild(face);

  // etichetta della copia (modificabile dal tray)
  if (isCopyEntry(t)) {
    const cap = document.createElement('span');
    cap.className = 'grid-copy-label';
    cap.textContent = t.label || 'Copia';
    card.appendChild(cap);
  }

  return card;
}

// aggiorna i conteggi stappate/tappate di una card senza ricostruire la griglia
// (usato dopo un tap, che non fa rebuild per far animare la rotazione)
function updateGridCounts(id) {
  const card = els.gridScroll.querySelector('.grid-card[data-id="' + id + '"]');
  if (!card) return;
  const instances = Storage.getInstances(id);
  const tapped = instances.filter(i => i.tapped).length;
  const face = card.querySelector('.grid-face .grid-count');
  const tap = card.querySelector('.grid-count-tap');
  if (face) face.textContent = instances.length - tapped;
  if (tap) tap.textContent = tapped;
}

// tocco sulla griglia: seleziona la card (o "+" per aggiungere un token)
els.gridScroll.addEventListener('click', e => {
  if (selectMode) return;
  if (e.target.closest('.grid-add')) { openSearch(); return; }
  const card = e.target.closest('.grid-card');
  if (!card || card.dataset.id === selectedId) return;
  // sposta l'evidenziazione in-place (niente rebuild → lo scroll non salta)
  const prev = els.gridScroll.querySelector('.grid-card.selected');
  if (prev) prev.classList.remove('selected');
  card.classList.add('selected');
  selectedId = card.dataset.id;
  renderTray();
});

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

    // etichetta modificabile: solo per i token copia, non in selezione
    const copy = isCopyEntry(t);
    els.copyField.hidden = !copy || Boolean(selectMode);
    if (els.copyField.hidden) closeSuggest();
    if (copy && document.activeElement !== els.copyLabel) {
      els.copyLabel.value = t.label || '';
    }
    if (copy && pendingFocusCopy === t.id) {
      pendingFocusCopy = null;
      els.copyLabel.focus();
    }

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
      face.className = 'mini-face';
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

  // tap/untap: aggiorna SOLO questa mini (niente rebuild del tray) così la
  // rotazione della carta può animarsi con la transizione CSS.
  Storage.toggleTap(selectedId, i);
  const inst = Storage.getInstances(selectedId)[i];
  const t = tokenById(selectedId);
  mini.classList.toggle('tapped', inst.tapped);
  if (t) {
    mini.setAttribute('aria-label', inst.tapped
      ? `${t.name} tappato: tocca per stappare`
      : `${t.name} stappato: tocca per tappare`);
  }
  // aggiorna i conteggi stappate/tappate sulla card della griglia
  updateGridCounts(selectedId);
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
  if (!els.confirmClear.hidden) { els.confirmClear.hidden = true; return; }
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

els.searchInput.addEventListener('input', e => runSearch(e.target.value));
els.searchModeDeck.addEventListener('click', () => setSearchMode('deck'));
els.searchModeScryfall.addEventListener('click', () => setSearchMode('scryfall'));
els.searchClose.addEventListener('click', closeSearch);

// --- etichetta della copia (input nel tray con autocomplete, solo per le copie) ---
// applica il testo all'etichetta della copia selezionata: salva, aggiorna la
// caption sulla card e (con debounce) recupera l'immagine della carta nominata
function applyCopyLabel(value) {
  const t = selectedId ? tokenById(selectedId) : null;
  if (!isCopyEntry(t)) return;
  t.label = value;
  Storage.saveTokens(allTokens);
  // aggiorna la sola card selezionata senza ricostruire (non perde il focus)
  const card = els.gridScroll.querySelector('.grid-card[data-id="' + t.id + '"]');
  if (card) {
    let cap = card.querySelector('.grid-copy-label');
    if (!cap) {
      cap = document.createElement('span');
      cap.className = 'grid-copy-label';
      card.appendChild(cap);
    }
    cap.textContent = t.label || 'Copia';
    card.setAttribute('aria-label', t.label ? `Copia: ${t.label}` : 'Copia senza nome');
  }
  scheduleCopyImageFetch(t);
}

// --- autocomplete dei nomi carta (Scryfall) sull'input della copia ---
let acTimer = null;
let acSeq = 0;
let acController = null;
let acItems = [];
let acIndex = -1;

function scheduleAutocomplete(value) {
  clearTimeout(acTimer);
  const q = value.trim();
  if (q.length < 2) { closeSuggest(); return; }
  acTimer = setTimeout(async () => {
    const seq = ++acSeq;
    if (acController) acController.abort();
    acController = new AbortController();
    try {
      const names = await Scryfall.autocomplete(q, acController.signal);
      if (seq !== acSeq) return; // superata da una richiesta più recente
      renderSuggestions(names.slice(0, 8));
    } catch (e) { /* abort o rete: lascia il dropdown com'è */ }
  }, 220);
}

function renderSuggestions(names) {
  acItems = names;
  acIndex = -1;
  els.copySuggest.innerHTML = '';
  if (!names.length) { closeSuggest(); return; }
  names.forEach((name, i) => {
    const li = document.createElement('li');
    li.className = 'copy-suggest-item';
    li.setAttribute('role', 'option');
    li.dataset.index = i;
    li.textContent = name;
    // mousedown (non click): scatta prima del blur, così non perdo la selezione
    li.addEventListener('mousedown', e => { e.preventDefault(); selectSuggestion(name); });
    els.copySuggest.appendChild(li);
  });
  els.copySuggest.hidden = false;
  els.copyLabel.setAttribute('aria-expanded', 'true');
}

function moveActive(delta) {
  if (!acItems.length) return;
  acIndex = (acIndex + delta + acItems.length) % acItems.length;
  [...els.copySuggest.children].forEach((li, i) => li.classList.toggle('active', i === acIndex));
}

function selectSuggestion(name) {
  els.copyLabel.value = name;
  applyCopyLabel(name);
  closeSuggest();
  els.copyLabel.focus();
}

function closeSuggest() {
  clearTimeout(acTimer);
  if (acController) acController.abort();
  els.copySuggest.hidden = true;
  els.copySuggest.innerHTML = '';
  els.copyLabel.setAttribute('aria-expanded', 'false');
  acItems = [];
  acIndex = -1;
}

els.copyLabel.addEventListener('input', () => {
  applyCopyLabel(els.copyLabel.value);
  scheduleAutocomplete(els.copyLabel.value);
});
els.copyLabel.addEventListener('keydown', e => {
  const open = !els.copySuggest.hidden && acItems.length > 0;
  if (e.key === 'ArrowDown' && open) { e.preventDefault(); moveActive(1); }
  else if (e.key === 'ArrowUp' && open) { e.preventDefault(); moveActive(-1); }
  else if (e.key === 'Enter') {
    if (open && acIndex >= 0) { e.preventDefault(); selectSuggestion(acItems[acIndex]); }
    else els.copyLabel.blur();
  } else if (e.key === 'Escape' && open) {
    e.preventDefault();
    closeSuggest();
  }
});
els.copyLabel.addEventListener('blur', closeSuggest);

// il campo nome copia sta accanto al menu in landscape, nel tray in portrait
const copyFieldMQ = matchMedia('(orientation: portrait)');
function placeCopyField() {
  if (copyFieldMQ.matches) {
    if (els.copyField.parentElement !== els.tray) els.tray.insertBefore(els.copyField, els.trayGrid);
  } else if (els.copyField.parentElement !== els.boardControls) {
    els.boardControls.insertBefore(els.copyField, els.btnMenu);
  }
}
copyFieldMQ.addEventListener('change', () => { closeSuggest(); placeCopyField(); });
placeCopyField();

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
  els.deckTitle.value = '';
  els.input.value = '';
  renderRecents();
  setStatus('Mazzo rimosso. Incolla una nuova decklist per continuare.');
});

// --- import handlers ---
els.btnAnalyze.addEventListener('click', () => analyzeDeck(parseDecklist(els.input.value)));
els.btnClearInput.addEventListener('click', () => {
  els.deckTitle.value = '';
  els.input.value = '';
  setStatus('');
});

// --- ultimi mazzi ---
function fmtRecentDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  } catch (e) {
    return '';
  }
}

function renderRecents() {
  const decks = Storage.getRecentDecks();
  els.recentList.innerHTML = '';
  els.recentEmpty.hidden = decks.length > 0;
  els.btnClearRecent.disabled = decks.length === 0;

  decks.forEach(d => {
    const item = document.createElement('button');
    item.className = 'recent-item';
    item.dataset.id = d.id;

    // wrapper interno: è qui che vive il flex (il <button> resta un blocco)
    const inner = document.createElement('span');
    inner.className = 'recent-inner';

    const thumb = document.createElement('span');
    thumb.className = 'recent-thumb';
    const firstImg = (d.tokens || []).find(t => t.image);
    if (firstImg) {
      const img = document.createElement('img');
      img.loading = 'lazy'; img.alt = ''; img.src = firstImg.image;
      thumb.appendChild(img);
    }
    inner.appendChild(thumb);

    const info = document.createElement('span');
    info.className = 'recent-info';
    const title = document.createElement('span');
    title.className = 'recent-title';
    title.textContent = d.title || 'Mazzo senza titolo';
    const meta = document.createElement('span');
    meta.className = 'recent-meta';
    const n = (d.tokens || []).length;
    meta.textContent = [`${n} token`, fmtRecentDate(d.savedAt)].filter(Boolean).join(' · ');
    info.appendChild(title);
    info.appendChild(meta);
    inner.appendChild(info);

    item.appendChild(inner);
    item.addEventListener('click', () => loadRecentDeck(d.id));
    els.recentList.appendChild(item);
  });
}

// tap su un mazzo recente: diventa il mazzo attivo (board pulita) e apre la board
function loadRecentDeck(id) {
  const d = Storage.getRecentDeck(id);
  if (!d) return;
  Storage.saveDeck(d.cardNames, d.tokens, d.title);
  Storage.touchRecentDeck(id); // riportalo in cima allo storico
  els.deckTitle.value = d.title || '';
  els.input.value = d.cardNames.join('\n');
  renderRecents();
  enterBoard(d.tokens);
}

els.btnClearRecent.addEventListener('click', () => {
  if (Storage.getRecentDecks().length === 0) return;
  els.confirmClear.hidden = false;
});
els.confirmClearNo.addEventListener('click', () => { els.confirmClear.hidden = true; });
els.confirmClearYes.addEventListener('click', () => {
  Storage.clearRecentDecks();
  els.confirmClear.hidden = true;
  renderRecents();
});
// tap sullo scrim (fuori dal riquadro) = annulla
els.confirmClear.addEventListener('click', e => {
  if (e.target === els.confirmClear) els.confirmClear.hidden = true;
});

// --- ripristino sessione ---
(function init() {
  renderRecents();
  const deck = Storage.loadDeck();
  if (deck && deck.tokens.length > 0) {
    els.deckTitle.value = deck.title || '';
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
