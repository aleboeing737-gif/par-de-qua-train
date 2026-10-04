Par De Qua Train v0.8.1 REAL FIX

Build completa per Cloudflare Pages Advanced Mode.

Fix principale:
- usa i dati esatti di codOrigine e dataPartenzaTreno restituiti da /partenze;
- interroga /andamentoTreno con la corsa esatta;
- ricava l'ultima fermata effettivamente rilevata;
- usa /getCoordinateStazione per ottenere le coordinate della stazione rilevata;
- non richiede coordinate lat/lon dentro l'oggetto fermata;
- endpoint diagnostico /api/v1/source-status per verificare la risposta ViaggiaTreno.

File da mettere nella root:
index.html
app.js
app.css
_worker.js
_headers
README.txt

Nessun treno o GPS viene inventato.
