# Cloudflare Pages Direct Deployment Tool

Deploy static folders and HTML files directly to the Cloudflare Pages edge network from a local web dashboard or terminal CLI, keeping Cloudflare credentials on the server.

## What it does not do

- Does not compile or bundle frontend source files (TypeScript, JSX, SCSS, or framework projects must be built to static HTML, CSS, and JS before deploying).
- Does not manage Cloudflare Workers, Functions, KV, D1, or R2 bindings.
- Does not provide user authentication or multi-tenant access control.
- Does not manage custom domains or DNS records.

## Requirements

- Node.js 18.0.0 or higher (tested on Node.js v24.18.0, npm 11.16.0).
- Cloudflare account (Free or paid).
- Cloudflare Account ID (32 hexadecimal characters).
- Cloudflare API Token with `Account` -> `Cloudflare Pages` -> `Edit` permissions.

## Setup

1. Clone or download the repository, then navigate to the project root:
```bash
cd c:/QR/Gigs
```

2. Install dependencies:
```bash
npm install
```

3. Create your local environment file:
```bash
cp .env.example .env
```

4. Open `.env` and fill in your Cloudflare credentials:
```env
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
CLOUDFLARE_PROJECT_NAME=random-pages-vault
```

5. Start the server:
```bash
npm start
```

Expected output:
```
⚡ Cloudflare Pages Workflow & Auto-Updating Quota Dashboard running on:
   👉 http://localhost:3000
```

Open `http://localhost:3000` in your browser.

## Configuration

All configuration is loaded from `.env` via `lib/config.js`.

| Name | Required | Where used | What it does |
| :--- | :--- | :--- | :--- |
| `CLOUDFLARE_ACCOUNT_ID` | Yes (for live deploys) | Server only | 32-character hexadecimal string identifying your Cloudflare account. |
| `CLOUDFLARE_API_TOKEN` | Yes (for live deploys) | Server only | Cloudflare API token (~40-50 characters) with Pages Edit scope. |
| `CLOUDFLARE_PROJECT_NAME` | No (default: `random-pages-vault`) | Server and client | The target Cloudflare Pages project name. Auto-created on first deploy if missing. |
| `DAILY_FREE_LIMIT` | No (default: `100`) | Server and client | Max direct uploads allowed per UTC day before the server rejects new requests. |
| `MONTHLY_BUILD_LIMIT` | No (default: `500`) | Server and client | Monthly build cap threshold displayed on the dashboard monitor. |
| `DEFAULT_DEPLOY_MODE` | No (default: `branch`) | Server only | Default URL style: `branch` (subdomain) or `path` (subdirectory). |
| `PORT` | No (default: `3000`) | Server only | Port number for the local Express HTTP server. |

## Usage

### Web dashboard

1. Open `http://localhost:3000`.
2. Drop a static folder into the dropzone, or click "Select files" / "Select folder".
3. Check the site name (slug). Click "New random name" or type a custom slug.
4. Select the URL style:
   - **Subdomain (`branch`)**: live at `https://<slug>.<projectName>.pages.dev` (e.g., `https://landing-demo.random-pages-vault.pages.dev`).
   - **Path directory (`path`)**: live at `https://<projectName>.pages.dev/r/<slug>` (e.g., `https://random-pages-vault.pages.dev/r/landing-demo`).
5. Click **Deploy**.
6. The terminal stream outputs Wrangler logs. Once finished, copy the URL or download the QR code.

### Command-line interface

Check current quota status and countdown:
```bash
npm run status
```

Stage and run a dry-run preview:
```bash
npm run deploy:preview
```

Deploy a randomly generated page directly to Cloudflare Pages:
```bash
npm run deploy:random
```

Deploy a specific built-in template with custom text:
```bash
node cli/cli.js --deploy --template secret --title "Confidential Doc" --content "Access code: 9481"
```

## How it works

The browser frontend reads dropped files and sends their contents via `POST /api/deployments/generate`. The Express server receives the payload, writes the staged directory structure under `dist/builds/<slug>`, and spawns `npx wrangler pages deploy <deployDir>`. Wrangler uploads the files directly to Cloudflare Pages. Once Wrangler returns an exit code of 0, the server appends the deployment record to `data/deployments.json` and returns the live URL to the client.

```
Browser Dropzone ──> Express Server (/api/deployments/generate)
                           │
                           ├──> Stages files to dist/builds/<slug>
                           ├──> Spawns: npx wrangler pages deploy
                           │         │
                           │         └──> Cloudflare Pages Edge CDN
                           │
                           └──> Appends record to data/deployments.json
```

- **Deployment records**: Stored in `data/deployments.json` on the server filesystem.
- **Device configuration**: Stored in `data/devices.json` on the server and `localStorage` on the client.
- **Quota counters**: Computed dynamically on each request by comparing timestamps in `data/deployments.json` against `00:00:00 UTC` and the 1st of the current month.
- **UI settings**: URL style selection and auto-rename toggle reside in client memory only and reset on reload.
- **Persistence**: All files inside `data/` and `.env` survive server restarts, provided the host filesystem is non-ephemeral.

## Quotas and limits

Limits checked against official [Cloudflare Pages platform limits documentation](https://developers.cloudflare.com/pages/platform/limits/) on October 29, 2026.

| Metric | Limit | Enforced by |
| :--- | :--- | :--- |
| **Max file size** | 25 MiB per individual asset | Cloudflare Pages and dashboard client validator (`public/js/dashboard.js`) |
| **Max file count** | 20,000 files per deployment (Free plan) | Cloudflare Pages and dashboard client validator (`public/js/dashboard.js`) |
| **Daily uploads** | 100 uploads per day (default configurable) | Application server (`server/server.js`) |
| **Monthly builds** | 500 builds per month (Free plan) | Cloudflare Pages platform |
| **Projects** | 100 projects per account | Cloudflare Pages platform |
| **Active preview deployments** | Unlimited | Cloudflare Pages platform |

- **Daily quota counter resets at**: `00:00:00 UTC` every night.
- **Monthly build counter resets at**: `00:00:00 UTC` on the 1st of every calendar month.

## Security notes

- **Secret storage**: Cloudflare API tokens and Account IDs live in `.env` and `data/devices.json` on the server. If configured via the web UI Settings modal, credentials are also stored in the browser's `localStorage` under `cf_device_vault_<deviceId>`.
- **Frontend visibility**: The dashboard queries `/api/status`, which provides a masked Account ID (e.g. `5594b4...`). However, the `/api/config` endpoint returns the stored credentials in its JSON response body upon save.
- **Device ID**: The device ID (`DEV-...`) generated by the client is a random identifier stored in `localStorage`, not a secret or authentication token.
- **Uploaded folder contents**: The staging pipeline in `lib/page-generator.js` copies all uploaded files into the deployment folder without filtering hidden files or dotfiles. **Do not upload folders containing `.env` files, `.git` directories, or private keys**, as they will be published directly to the public Cloudflare Pages URL.

## Troubleshooting

### `Cloudflare deployment failed (code 1)`
- **Cause**: Wrangler failed during deployment. Common causes include invalid API token, missing Account ID, or expired credentials.
- **Fix**: Verify your token permissions (`Account.Cloudflare Pages: Edit`) and ensure `CLOUDFLARE_ACCOUNT_ID` matches your Cloudflare account. Run `npm run cf:whoami` to test.

### `Daily free tier deployment limit reached (100/100)`
- **Cause**: The number of deployments created today has reached `DAILY_FREE_LIMIT`.
- **Fix**: Wait until `00:00 UTC` for the automated quota reset, or increase `DAILY_FREE_LIMIT` in `.env` and restart the server.

### `Project '<name>' does not exist yet`
- **Cause**: The Pages project has not been provisioned on Cloudflare, and the API token lacks permission to auto-create projects.
- **Fix**: Run `npx wrangler pages project create <name> --production-branch main` in your terminal to create the project manually.

### `SyntaxError: Unexpected token in JSON`
- **Cause**: Corrupted or truncated JSON syntax in `data/deployments.json` or `data/devices.json`.
- **Fix**: Open `data/deployments.json` and restore valid JSON array syntax (`[]`), or delete the file (the server will re-create an empty array).

## Known limitations

- **Shared ledger**: Deployments in `data/deployments.json` are stored in a single flat array on the server and are not segregated per device ID. All clients connected to the same server instance see all deployment records.
- **Device ID persistence**: The device ID lives in browser `localStorage`. Clearing site data generates a new ID and orphans any credentials stored in that browser's client vault.
- **Concurrent deployment race conditions**: `data/deployments.json` is updated via non-atomic read-modify-write operations without file locking. Simultaneous deployments from multiple tabs can overwrite each other.
- **Unpersisted preferences**: URL style selection and auto-rename settings reset to defaults when the page is reloaded.
- **Ephemeral hosting**: When hosted on platforms without persistent storage (e.g., stateless Docker containers or serverless runtimes), files in `data/` and `dist/` will be wiped on restart.
