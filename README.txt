PAR DE QUA TRAIN v0.7.1
REAL LIVE TRAINS + REAL OSM RAIL NETWORK

CLOUDFLARE PAGES ADVANCED MODE

Upload/deploy the CONTENTS of this folder at the project root.
Do NOT put these files inside another folder.

Required root files:
- index.html
- app.js
- app.css
- _worker.js
- _headers

IMPORTANT:
- _worker.js is the Cloudflare Pages Advanced Mode function.
- It serves /api/* and forwards all other requests to env.ASSETS.fetch().
- The live train data comes from ViaggiaTreno through the Par De Qua Train API.
- Railway geometry is real OpenStreetMap data.
- Train positions are never presented as GPS unless the provider supplies GPS.
- Estimated positions are explicitly marked as estimated.

VERSION: 0.7.1
