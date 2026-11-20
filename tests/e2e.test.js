const assert = require('assert');
const { chromium } = require('playwright');
const app = require('../server/server');

async function runE2ETestSuite() {
  console.log('====================================================');
  console.log('       PLAYWRIGHT E2E BROWSER TEST SUITE            ');
  console.log('====================================================\n');

  let server;
  let browser;
  let baseUrl;
  let passed = 0;
  let total = 0;

  function recordPass(name) {
    passed++;
    console.log(`[PASS] ${name}`);
  }

  function recordFail(name, err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
  }

  try {
    // 1. Spin up ephemeral server
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // 2. Launch Chromium
    total++;
    try {
      browser = await chromium.launch({
        headless: true
      });
      recordPass('Playwright Chromium browser launched successfully');
    } catch (err) {
      recordFail('Playwright Chromium browser launched successfully', err);
      throw err;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    // 3. Navigation & Title Verification
    total++;
    try {
      const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      assert(response.status() === 200, `Expected HTTP 200, got ${response.status()}`);
      const title = await page.title();
      assert(title.includes('Cloudflare Pages'), `Expected title to contain 'Cloudflare Pages', got '${title}'`);
      recordPass('Dashboard loads and serves HTTP 200 with valid document title');
    } catch (err) {
      recordFail('Dashboard loads and serves HTTP 200 with valid document title', err);
    }

    // 4. Brand Tag & Layout Elements
    total++;
    try {
      const brandTag = await page.textContent('.brand-tag');
      assert.strictEqual(brandTag.trim(), 'PAGES DROP');
      const dropZoneVisible = await page.isVisible('#dropZone');
      assert(dropZoneVisible, 'Dropzone (#dropZone) must be visible in UI');
      recordPass('Brand header and primary deployment dropzone render correctly');
    } catch (err) {
      recordFail('Brand header and primary deployment dropzone render correctly', err);
    }

    // 5. Connect Wizard Modal Interaction
    total++;
    try {
      await page.click('#headerConnectWizardBtn');
      await page.waitForSelector('#cloudflareConnectWizardModal', { state: 'visible' });
      const modalVisible = await page.isVisible('#cloudflareConnectWizardModal');
      assert(modalVisible, 'Connect Wizard modal should be visible after button click');

      // Check close button
      await page.click('#closeWizardModalBtn');
      await page.waitForSelector('#cloudflareConnectWizardModal', { state: 'hidden' });
      const modalClosed = !(await page.isVisible('#cloudflareConnectWizardModal'));
      assert(modalClosed, 'Connect Wizard modal should close when close button is clicked');
      recordPass('Connect Wizard modal opens and closes via user interaction');
    } catch (err) {
      recordFail('Connect Wizard modal opens and closes via user interaction', err);
    }

    // 6. Device Identity Registration Verification
    total++;
    try {
      const deviceId = await page.evaluate(() => localStorage.getItem('cf_device_id'));
      assert(deviceId && deviceId.startsWith('DEV-'), `Expected DEV-* ID in localStorage, got '${deviceId}'`);
      recordPass('Device pairing credentials successfully negotiated and stored');
    } catch (err) {
      recordFail('Device pairing credentials successfully negotiated and stored', err);
    }

    await page.close();
    await context.close();
  } catch (err) {
    console.error('E2E Suite Critical Error:', err.message);
  } finally {
    if (browser) await browser.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n====================================================');
  console.log(`Summary: ${passed}/${total} passed`);
  if (passed === total && total > 0) {
    console.log('Status:  All Playwright E2E browser tests passed.');
    console.log('====================================================');
    process.exit(0);
  } else {
    console.error(`Status:  ${total - passed} test(s) failed.`);
    console.log('====================================================');
    process.exit(1);
  }
}

runE2ETestSuite();
