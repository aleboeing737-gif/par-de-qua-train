# Par De Qua Train API v0.9.0

Deploy this folder as the Render Web Service.

Build command: none
Start command: `npm start`

Endpoints:
- `/health`
- `/api/v1/live/passenger`
- `/api/v1/source-status`

The server calls ViaggiaTreno itself, so Cloudflare Pages never contacts ViaggiaTreno directly.
