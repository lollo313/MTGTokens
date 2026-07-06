# Token Tracker MTG

PWA personale per individuare i token esatti generati da un mazzo Magic: The Gathering
e tenerne traccia con dei contatori durante la partita.

## Come funziona

1. Incolli la decklist (o, in via sperimentale, importi da un ID mazzo Archidekt).
2. L'app interroga l'API di Scryfall (`POST /cards/collection`) per risolvere le carte,
   poi legge il campo `all_parts` di ciascuna per trovare i token esatti che genera.
3. Per ogni token trovato, recupera nome e immagine esatti (sempre via Scryfall) e li
   mostra a schermo con un contatore +/-.
4. Tutto lo stato (mazzo corrente, contatori) resta in `localStorage` sul telefono:
   nessun server, nessun account.

## Struttura del progetto

```
index.html         pagina unica dell'app
manifest.json       metadati PWA (nome, icone, colori)
sw.js               service worker: cache dell'app shell per l'uso offline
css/style.css       stile
js/storage.js       persistenza locale (mazzo, contatori)
js/scryfall.js      chiamate all'API Scryfall
js/app.js           logica UI e collegamento tra i moduli
icons/              icone placeholder 192x192 e 512x512 — sostituiscile con le tue
```

## Deploy (hosting statico gratuito)

Qualsiasi hosting di file statici con HTTPS va bene. Opzioni consigliate:

- **GitHub Pages**: crea un repo, carica questi file, attiva Pages nelle impostazioni
  del repo (branch `main`, cartella `/`). URL tipo `tuonome.github.io/token-tracker`.
- **Netlify** o **Vercel**: collega il repo Git, deploy automatico ad ogni push,
  zero configurazione necessaria.
- **Cloudflare Pages**: stessa fascia di Netlify/Vercel.

Non serve alcun backend: sono solo file statici.

## Installazione sul telefono

1. Apri l'URL dell'app nel browser del telefono (Chrome/Safari).
2. Menu del browser → "Aggiungi a schermata Home" (Android) o "Aggiungi a Home"
   (iOS, dal menu Condividi di Safari).
3. L'app si comporta come un'app installata: icona propria, schermo intero, funziona
   anche offline per il mazzo già analizzato in precedenza.

## Limiti noti

- **Import da Archidekt**: l'endpoint usato (`archidekt.com/api/decks/{id}/`) non è
  documentato ufficialmente e potrebbe rifiutare richieste dirette dal browser per
  motivi di CORS. Se non funziona, resta sempre possibile copiare la decklist da
  Archidekt (o qualsiasi altro deckbuilder) e incollarla nel campo di testo.
- **Corrispondenza nomi carta**: `/cards/collection` richiede il nome esatto della
  carta (case-insensitive, ma non tollera errori di battitura). Decklist esportate da
  Archidekt, Moxfield o simili funzionano senza problemi.
- **Icone**: quelle incluse sono segnaposto generati automaticamente. Sostituiscile in
  `icons/icon-192.png` e `icons/icon-512.png` con qualcosa di tuo (stesse dimensioni).

## Possibili estensioni future

- Import diretto da Moxfield (API più stabile di Archidekt).
- Contatori di vita/veleno oltre ai token.
- Sincronizzazione tra dispositivi (richiederebbe un piccolo backend, es. Firebase).
