PAR DE QUA TRAIN v0.7.2
========================

Build pulita per Cloudflare Pages Advanced Mode.

FILE DA PUBBLICARE NELLA ROOT DEL REPOSITORY:
- index.html
- app.js
- app.css
- _worker.js
- _headers

IMPORTANTE:
- NON serve una cartella functions.
- NON serve un comando di build.
- NON caricare il file ZIP dentro la root del repository.
- Cloudflare Pages deve usare il branch main e la root del repository.

Cosa fa:
- mappa MapLibre + OpenFreeMap/OpenStreetMap;
- rete ferroviaria reale dal layer vettoriale OpenFreeMap;
- discovery di treni passeggeri tramite ViaggiaTreno;
- ricerca singolo treno;
- marker basati sull'ultimo rilevamento reale;
- nessun GPS inventato;
- nessun Overpass necessario all'avvio.

Fonte ferroviaria:
ViaggiaTreno, tramite interfacce pubbliche/non ufficiali.
