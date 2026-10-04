Par De Qua Train v0.8.0 REAL
Build unica pulita.

Cloudflare Pages Advanced Mode:
- repository root
- nessun build command
- _worker.js nella root
- non caricare lo ZIP nel repository

Questa versione usa ViaggiaTreno come sorgente dei treni attivi.
Scopre treni da più stazioni, verifica ogni corsa con andamentoTreno e usa solo
l'ultima rilevazione reale con coordinate quando disponibile.

IMPORTANTE: ViaggiaTreno è un'API non ufficialmente documentata e può restituire
204 o cambiare comportamento. La build non inventa treni o GPS.
