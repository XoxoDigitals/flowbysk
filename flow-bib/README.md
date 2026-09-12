# Flow BiB multi-account manager

One Puppeteer Chrome per Google provider account for login + reCAPTCHA only.
Generation uses server-side batchexecute POSTs (parallel across Flow projects).

## Run

```bash
npm install
npm start
# listens on http://127.0.0.1:8010
```

From SaaS root: `npm run bib` or `npm run dev:all`.

## Key routes

- `POST /accounts/:id/launch`
- `POST /accounts/:id/disconnect`
- `POST /accounts/:id/ensure-projects` body `{ maxSlots }`
- `GET /accounts/:id/status`
- `WS /ws/:accountId` screencast + input
- `POST /generate` `{ accountId, prompt, model, aspectRatio, projectId? }`
- `POST /batch-run` parallel images
- `POST /generate-video`
- `POST /bootstrap` auto-launch list

Profiles persist under `../data/bib-profiles/{accountId}/`.
