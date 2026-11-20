# AGENTS.md

## Commands

### Setup & Installation
- Install dependencies: `npm install`
- Verify requirements and launch: `npm start` (runs `scripts/start-runner.js`, checks `requirements.txt`, auto-installs missing packages if needed, and starts the server)

### Development & Execution
- Start server (standard): `npm start` (spawns `server/server.js` on `http://127.0.0.1:3000`)
- Start server with auto-reload: `npm run dev` (`node --watch server/server.js`)
- Deploy random page via CLI: `npm run deploy:random` (or `node cli/cli.js --deploy`)
- Dry-run preview via CLI: `npm run deploy:preview` (or `node cli/cli.js --dry-run`)
- Inspect CLI status & quotas: `npm run status` (or `node cli/cli.js --status`)
- Reset device pairing credentials: `npm run reset:device` (or `node scripts/reset-device.js`)
- Cloudflare CLI diagnostics: `npm run cf:whoami`, `npm run cf:projects`

### Code Quality & Linting
- Validate syntax across all files: `npm run lint` (or `node scripts/lint.js`)
- Typecheck & integrity check: `npm run typecheck`

### Testing
- Run all test suites: `npm test`
- Run individual test suites:
  - Security & audit regression: `npm run test:security` (or `node tests/security_regression.test.js`)
  - Feature lifecycle & API: `npm run test:features` (or `node tests/new_features.test.js`)
  - Cloudflare connect wizard: `npm run test:wizard` (or `node tests/cloudflare_wizard.test.js`)
  - Playwright E2E browser verification: `npm run test:e2e` (or `node tests/e2e.test.js`)

## Prerequisites & Environment

- **Runtime:** Node.js `>= 18.0.0` (pinned in `.nvmrc` and `engines.node`; required for native `fetch`, native `crypto.hkdfSync`, and `node --watch`).
- **External CLI:** Wrangler CLI (`npx wrangler`, managed via `devDependencies`).
- **Cloudflare Credentials:** API token with `Account.Cloudflare Pages: Edit` permissions and 32-character Hex Account ID.
- **Environment Configuration:** Copy `.env.example` to `.env`:
  - `CLOUDFLARE_ACCOUNT_ID`: 32-char hex string (Tier 2 fallback; optional if using browser Connect Wizard).
  - `CLOUDFLARE_API_TOKEN`: Cloudflare Pages API token (Tier 2 fallback; optional if using Connect Wizard).
  - `CLOUDFLARE_PROJECT_NAME`: Target Pages project name (defaults to `random-pages-vault` if unset).
  - `APP_SECRET_KEY`: 64-char hex string (32 bytes) used for at-rest encryption in production/hosted modes.
  - `DAILY_FREE_LIMIT`: Daily deployment quota threshold (default: `100`).
  - `MONTHLY_BUILD_LIMIT`: Cloudflare Free-tier monthly build limit monitor (default: `500`).
  - `DEFAULT_DEPLOY_MODE`: Deployment URL format (`branch` for subdomains, `path` for subdirectories).
  - `HOST`: Server interface binding (default: `127.0.0.1`).
  - `PORT`: Server HTTP listen port (default: `3000`).

## Repository Map

- `server/server.js`: Express application entrypoint. Configures middleware, rate limiting, and REST routes (`/api/status`, `/api/deploy`, `/api/deployments/*`, `/api/auth/*`, `/api/cloudflare/*`, `/api/config`).
- `cli/cli.js`: Standalone command-line client (`cf-random-pages`) for headless deployments, status, and dry runs.
- `lib/`: Core application domains and utilities:
  - `lib/auth.js`: Device pairing, PBKDF2/SHA-256 secret verification, device sessions, and rate-limit lockout.
  - `lib/vault.js`: Tier 1 encrypted device vault (`data/vaults/<deviceId>.json`) using AES-256-GCM + HKDF.
  - `lib/crypto-vault.js`: Tier 2 server-level encryption fallback using `APP_SECRET_KEY`.
  - `lib/config.js`: Two-tier configuration resolver (Device Vault -> `.env`), credential masking, and validation.
  - `lib/deployer.js`: Deployment runner; generates build payload and spawns Wrangler child process with isolated environment.
  - `lib/page-generator.js`: Generates random static HTML/CSS files, enforces path boundaries, and filters sensitive files.
  - `lib/templates.js`: HTML templates for deployed, preview, paused, and redirect pages.
  - `lib/tracker.js`: Atomic JSON persistence for `data/deployments.json`, quota counting, and corruption recovery.
  - `lib/device-storage.js`: Device metadata persistence for `data/devices.json`.
  - `lib/cf-api.js`: Cloudflare REST API client for token verification and project listing.
- `public/`: Web dashboard frontend assets (`index.html`, `css/style.css`, `js/dashboard.js`, `js/qrcode.js`).
- `scripts/`: Operational tools:
  - `scripts/start-runner.js`: `npm start` wrapper verifying dependencies from `requirements.txt`.
  - `scripts/lint.js`: Fast recursive codebase syntax and integrity linter.
  - `scripts/reset-device.js`: CLI tool to purge paired devices and encrypted vaults.
- `tests/`: Automated test suites (`security_regression.test.js`, `new_features.test.js`, `cloudflare_wizard.test.js`, `e2e.test.js`).
- `data/`: Runtime state directory (gitignored): contains `deployments.json`, `devices.json`, and `vaults/`.

## Architecture & Invariants

- **Two-Tier Credential Resolution:** Tier 1 Device Vault (`data/vaults/<deviceId>.json`, encrypted with AES-256-GCM via HKDF key derived from `device_secret`) overrides Tier 2 server fallback (`.env`).
- **Device Pairing Contract:** Protected `/api/*` endpoints require both the `X-Device-Id` header (`DEV-[A-Z0-9]{16}`) and the matching `device_secret` cookie (`HttpOnly`, `SameSite=Strict`).
- **Loopback Lockout Exemption:** `127.0.0.1` and `::1` are exempt from IP-based 15-minute brute-force lockouts in `lib/auth.js` to ensure reliable local automation and test execution.
- **Zero Token Leakage:** Cloudflare API tokens must never be sent in API response payloads, stored in client cookies/storage, or printed to logs. Tokens are passed to Wrangler strictly via child process `env`, never in CLI arguments (`argv`).
- **Upload Sanitization:** `lib/page-generator.js` rejects path traversal (`..`), absolute paths, and null bytes. It strips sensitive files (`.env*`, `.git/`, `.aws/`, `*.pem`, `*.key`, `id_rsa*`) at all directory depths before deployment.
- **Atomic Data Persistence:** `data/deployments.json` and `data/devices.json` use temp-file write + `fsync` + rename. Corrupted JSON creates `*.corrupt.<timestamp>.bak` and refuses destructive overwrites.

## Verification Workflow

Before considering any task complete, execute the following steps in order:

1. **Syntax Check & Linting:** Validate all JavaScript files:
   ```bash
   npm run lint
   ```
2. **Execute Full Test Suite:** Ensure all suites pass with zero failures:
   ```bash
   npm test
   ```
3. **Execute Targeted Test (if modifying specific components):**
   - Security / Sanitization / Vault: `npm run test:security`
   - Lifecycle / Pause / Redeploy: `npm run test:features`
   - Connect Wizard / Token validation: `npm run test:wizard`
   - Browser UI & Pairing: `npm run test:e2e`
4. **Git Hygiene Check:** Verify no runtime files (`data/`, `data/vaults/`, `*.corrupt.*.bak`), build artifacts (`dist/`, `.wrangler/`), or `.env` files are tracked:
   ```bash
   git status
   ```
