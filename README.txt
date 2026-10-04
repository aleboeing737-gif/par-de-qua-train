Par De Qua Train v0.8.2 REAL FIX 2

Fix critico:
- ViaggiaTreno richiede per /partenze un Date.toString-like completo con GMT offset.
- la build precedente inviava un timestamp senza GMT offset, quindi ViaggiaTreno poteva
  restituire nessun dato e l'app mostrava 0 treni.
- usato il base URL HTTP documentato da ViaggiaTreno.
- l'API ora espone diagnostics (hub interrogati, righe ricevute, candidati, errori).

File root:
index.html
app.js
app.css
_worker.js
_headers
README.txt

Nessun treno o GPS viene inventato.
