# ⚡ Cloudflare Pages Random Links Workflow & Daily Free Limit Dashboard

A high-performance automated workflow built with **Cloudflare Pages CLI (`wrangler`)** to generate live, globally distributed static pages with random links on Cloudflare's 330+ city Anycast Edge network, paired with a real-time **Daily Free Quota & Auto-Reset Dashboard**.

Designed specifically for **Cloudflare's Free Tier** (zero costs, unlimited bandwidth, and automated safeguards).

---

## 🌟 Key Highlights

- **🎲 Instant Random Link Generation:**
  - **Subdomain Branch Mode:** `https://<random-slug>.<project>.pages.dev` (Each deployment gets a dedicated SSL-secured preview subdomain).
  - **Sub-Directory Path Mode:** `https://<project>.pages.dev/r/<random-slug>` (Organized path-based routing under a single production domain).
- **📊 Real-Time Daily Free Limit Auto-Updation:**
  - Live tracking of daily direct uploads against Cloudflare Free Tier thresholds (`X / 100` safe direct uploads/day).
  - Monthly build monitor tracking against the free tier cap (`X / 500` builds/month).
  - Live countdown clock ticking down to the exact **00:00:00 UTC** daily reset.
  - Built-in **Free Tier Over-Limit Protection Guard** to prevent accidental overages.
- **🎨 Rich Pre-Styled Static Templates:**
  - **Modern Landing Page:** Hero typography, glassmorphism cards, responsive edge metadata.
  - **Secret Note / Ephemeral Document:** Blur-masked click-to-reveal protected content.
  - **Showcase / Drop:** Product features, responsive cards, print/export action.
  - **Bio Link Card:** Avatar, profile bio, social link buttons.
  - **Custom HTML / Markdown:** Inject your own raw markup or notes.
- **💻 Dual Interface (CLI + Dashboard):**
  - Run as a terminal CLI workflow (`node cli/cli.js --deploy ...`).
  - Or use the dark-mode glassmorphic visual Dashboard at `http://localhost:3000`.

---

## 🚀 Quick Start

### 1. Start the Visual Dashboard

```bash
# Start server
npm start
```
Open **`http://localhost:3000`** in your browser.

---

### 2. Run Directly from Terminal CLI

```bash
# Check your daily free quota & reset countdown
npm run status

# Generate and stage a random page with simulation/preview
npm run deploy:preview

# Generate and deploy a live page to Cloudflare
npm run deploy:random

# Deploy a specific template with custom headline
node cli/cli.js --deploy --template secret --title "Confidential Launch" --content "Passcode: 4892"

# Deploy with custom slug prefix
node cli/cli.js --deploy --prefix drop --title "Beta Release"
```

---

## ⚙️ Cloudflare Configuration (Free Tier)

The system works out of the box in **Simulation & Staging Mode** even without credentials so you can test the entire workflow immediately. 

To deploy live to the worldwide Cloudflare Edge CDN:

1. Copy `.env.example` to `.env` (or configure via the **"Cloudflare Config"** button inside the dashboard):
   ```bash
   cp .env.example .env
   ```

2. Open your [Cloudflare Dashboard](https://dash.cloudflare.com):
   - **Account ID:** Found in the right sidebar of the Cloudflare Dashboard Overview.
   - **API Token:** Go to **My Profile → API Tokens → Create Token**
     - Select **Create Custom Token**
     - Permissions:
       - `Account` → `Cloudflare Pages` → `Edit`
       - `User` → `Memberships` → `Read`
     - Account Resources: `Include` → `All Accounts` (or select your account)

3. Add your values to `.env`:
   ```env
   CLOUDFLARE_ACCOUNT_ID=your_account_id_here
   CLOUDFLARE_API_TOKEN=your_api_token_here
   CLOUDFLARE_PROJECT_NAME=random-pages-vault
   DAILY_FREE_LIMIT=100
   MONTHLY_BUILD_LIMIT=500
   ```

4. Or verify via Wrangler CLI:
   ```bash
   npm run cf:whoami
   ```

---

## 📈 Free Tier Limits Explained

| Metric | Cloudflare Free Plan Limit | How Workflow Manages It |
| :--- | :--- | :--- |
| **Direct Uploads** | Unlimited / ~100 per day safe pace | Tracked live on the dashboard with daily reset countdown |
| **Git Builds** | 500 builds / month | Direct uploads bypass Git build minutes; workflow tracks monthly builds |
| **Bandwidth** | **Unlimited (Unmetered)** | 100% Free worldwide Anycast delivery |
| **File Count** | Up to 20,000 files per project | Lightweight single-file and multi-file templates |
| **File Size** | Max 25 MB per asset | Self-contained HTML/CSS assets (< 15 KB each) |
| **Workers / Functions** | 100,000 requests / day | Static assets do not consume Worker requests |

---

## 🛠️ CLI Options Reference

```
node cli/cli.js [options]

  --deploy                Deploy live to Cloudflare Pages via Wrangler CLI
  --template <name>       Template: landing, secret, showcase, bio, custom (default: landing)
  --title <string>        Custom page headline
  --subtitle <string>     Custom subtitle
  --content <string>      Body content / text / encrypted message
  --slug <string>         Exact slug (default: 7-character cryptographic random string)
  --prefix <string>       Prefix for generated slug (e.g. "drop-", "vault-")
  --mode <branch|path>    Architecture: 'branch' (subdomain) or 'path' (directory)
  --status                Print live Daily Free Quota, Monthly Builds & Reset Countdown
  --dry-run               Simulate and stage files locally without uploading
  --help, -h              Display help guide
```

---

## 📁 Project Architecture

```
c:\QR\Gigs/
├── cli/
│   └── cli.js              # Command-line interface with colored output & quota checks
├── lib/
│   ├── config.js           # Configuration loader & persistent .env updater
│   ├── templates.js        # Responsive HTML templates with self-contained CSS
│   ├── page-generator.js   # Random slug generation & staging directory builder
│   ├── deployer.js         # Wrangler Pages CLI orchestrator & stream logger
│   ├── tracker.js          # Daily & monthly limit calculator with auto-reset
│   └── cf-api.js           # Cloudflare REST API client for live sync
├── server/
│   └── server.js           # Express API server for dashboard
├── public/
│   ├── index.html          # High-end glassmorphic Dashboard UI
│   ├── css/style.css       # Custom dark theme styles & micro-animations
│   └── js/dashboard.js     # Live ticker, QR code modal, search, and deployer
├── data/
│   └── deployments.json    # Local audit ledger of generated links
└── package.json            # Scripts & dependencies
```

---

## 🔒 Free Tier Safety Guard

The dashboard and CLI include an automated safeguard:
- If today's deployment count reaches your specified `DAILY_FREE_LIMIT` (default 100), new deployments are automatically paused until the daily UTC reset (`00:00:00 UTC`).
- This guarantees you never inadvertently exceed your planned free tier limits.
