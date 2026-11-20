# Cloudflare Pages Deployment Dashboard

A local web dashboard and command-line tool. You can deploy and manage static websites on Cloudflare Pages without exposing your secret credentials.

## Features

- **Direct Edge Deployment**: Deploy static folders or single HTML files directly to Cloudflare Pages through Wrangler.
- **Project Organization**: Group your deployments under dedicated Cloudflare Pages project names.
- **Two Routing Options**: Choose between subdomain branches (`https://<slug>.<project>.pages.dev`) and unified path routing (`https://<project>.pages.dev/r/<slug>`).
- **Deployment Lifecycle**: Pause live sites with a maintenance placeholder, resume original files, or redeploy with URL renaming and automatic redirects.
- **Shared History**: View deployments from both the web dashboard and terminal commands in one list.
- **QR Code Sharing**: Create scannable QR codes for your published website addresses.
- **Quota Tracking**: Monitor daily upload limits and monthly deployment counters with live countdown timers.

## Scope & Non-Goals

- **No Asset Compilation**: Build your frontend projects into static files before you upload them. The server does not compile TypeScript or framework source files.
- **No Backend Cloudflare Bindings**: The tool does not manage Cloudflare Workers, Functions, KV storage, or database bindings.
- **Single-Tenant Operation**: The system does not support multiple user accounts or role permissions. It protects local connections through browser device pairing.
- **No Custom DNS Management**: The tool does not configure custom domain names or DNS records.

## Requirements

- Node.js 18.0.0 or higher.
- Dependencies defined in `package.json` and `requirements.txt` (the startup script installs missing packages automatically).
- A Cloudflare account with an API token that has these permissions:
  - `Account > Cloudflare Pages > Edit`
  - `Account > Account Settings > Read`
  - Refer to the [Cloudflare API Tokens documentation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) for token creation steps.

## Quickstart

1. Download the project and open the folder:
```bash
git clone <repository-url>
cd cloudflare-pages-dashboard
```

2. Start the application:
```bash
npm start
```
The startup script verifies your dependencies and launches the local server.

3. Open your browser:
```text
http://localhost:3000
```

4. Connect your Cloudflare account:
   - **Through the Web Dashboard (Recommended)**: Open the Connect Wizard in the dashboard. Paste your Cloudflare API token. The server verifies your token, finds your Account ID automatically, and saves your credentials in an encrypted local vault.
   - **Through the Environment File (Headless or CLI)**: Copy `.env.example` to `.env`. Add your `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

## Configuration

You can update settings in the dashboard Settings dialog or write them into `.env`.

| Name | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `CLOUDFLARE_ACCOUNT_ID` | Optional for browser, required for CLI | None | Your 32-character Cloudflare account identifier. The web wizard detects this automatically. |
| `CLOUDFLARE_API_TOKEN` | Optional for browser, required for CLI | None | Your Cloudflare API token with Pages Edit and Account Settings Read permissions. |
| `CLOUDFLARE_PROJECT_NAME` | No | `random-pages-vault` | Target Cloudflare Pages project name. The server converts names to lowercase letters and hyphens. |
| `DAILY_FREE_LIMIT` | No | `100` | Maximum uploads allowed per day before the server pauses new uploads until midnight UTC. |
| `MONTHLY_BUILD_LIMIT` | No | `500` | Monthly build limit displayed on the quota monitor. |
| `DEFAULT_DEPLOY_MODE` | No | `branch` | Default routing mode (`branch` for subdomains, `path` for subdirectories). |
| `PORT` | No | `3000` | Local network port for the server. |

## Usage

### Web Dashboard

- **Upload and Deploy**: Drop a folder or static files into the drop zone. Type a project name and slug. Select your routing mode and click deploy.
- **Manage Deployments**: Open published links, copy URLs, show QR codes, pause or resume live sites, redeploy updated assets, or delete records.

### Command-Line Interface (CLI)

Check quota and reset countdown:
```bash
npm run status
```

Preview files locally without uploading:
```bash
npm run deploy:preview
```

Deploy a generated test page:
```bash
npm run deploy:random
```

Deploy a specific template with custom text:
```bash
node cli/cli.js --deploy --project-name "marketing" --template landing --title "Launch Page"
```

Clear saved device pairing credentials:
```bash
npm run reset:device
```

## Security Layer

This project runs on your local machine and protects your Cloudflare credentials at every step. It keeps your Cloudflare API token safe from browser scripts, system process lists, and public deployments.

### Browser Device Pairing

When you open the dashboard, the server pairs with your browser session.

- The server generates a unique device identifier and a random secret key.
- The server stores the secret key inside an HTTP-only browser cookie (`HttpOnly`, `SameSite=Strict`). Client-side JavaScript cannot read or copy this cookie.
- Every API request sends the device identifier in an `X-Device-Id` request header and the secret key in the cookie.
- The server compares secret hashes in constant time (`crypto.timingSafeEqual`) before it accepts any request.

### Credential Vaults on Disk

When you connect Cloudflare through the wizard, the server locks your credentials into a private vault file.

- The server encrypts your Cloudflare API token before it writes anything to disk (`AES-256-GCM`).
- The server never stores the raw encryption key on disk. It derives the key in memory via HKDF (`RFC 5869`) only when your paired browser makes an authenticated request.
- The encrypted vault uses tamper-detection tags (16-byte GCM authentication tag). If anyone alters the vault file on disk, decryption fails immediately and the server refuses access.
- If you use the command line instead of the browser, the server reads fallback credentials from your local environment file (`.env`).

### Secret Redaction and API Protection

Your Cloudflare API token never leaves the server.

- The server never includes your Cloudflare API token in API responses or web pages.
- The dashboard interface always masks your Cloudflare Account ID so observers cannot read it.
- The server scrubs your Cloudflare API token from terminal logs and error output before displaying them.
- If an unknown visitor attempts repeated failed pairing or authentication attempts, the server locks out that client address.

### Safe Deployments and File Filtering

When you drop a folder to deploy, the server scans all files before uploading them to Cloudflare Pages.

- The scanner blocks sensitive files at every directory depth.
- It automatically drops environment files (`.env`), Git metadata directories (`.git`), cloud provider keys (`.aws`), and private SSH keys.
- You cannot accidentally publish secret keys or repository history to the public internet.

### Environment-Based Token Passing

When the server uploads your website to Cloudflare Pages:

- It runs the deployment tool in a separate child process.
- It passes your Cloudflare API token through process environment variables.
- The token never appears in command-line arguments. Other users on your computer cannot see your token by viewing system process listings.

For sequence diagrams and protocol specifications, see [docs/architecture.md](docs/architecture.md).

## Quotas and Limits

Limits align with official [Cloudflare Pages platform limits](https://developers.cloudflare.com/pages/platform/limits/):

| Metric | Limit | Enforced by |
| :--- | :--- | :--- |
| **Max file size** | 25 MiB per individual asset | Cloudflare Pages and browser validator |
| **Max file count** | 20,000 files per deployment | Cloudflare Pages and browser validator |
| **Daily uploads** | 100 uploads per day | Cloudflare Pages platform and server quota counter |
| **Monthly builds** | 500 builds per month (Free tier) | Cloudflare Pages platform |

- Daily quota counters reset at `00:00:00 UTC` daily.
- Monthly counters reset at `00:00:00 UTC` on the first day of each calendar month.

## Verification & Testing

Run the test suite:

```bash
npm test
```

Test coverage includes:

- Path traversal blocking and file upload sanitization
- Sensitive file and directory exclusion across all folders
- Device pairing verification and authentication boundaries
- Safe storage writes and automatic file corruption recovery
- Deployment lifecycle actions (pause, resume, redeploy, URL renaming)
- Authenticated vault encryption, key derivation, and rate limiting
- End-to-end browser workflows and telemetry verification (Playwright)
