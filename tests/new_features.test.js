const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  buildPausedPageHtml,
  buildRedirectPageHtml
} = require('../lib/page-generator');

const {
  saveDeploymentRecord,
  getDeploymentRecord,
  updateDeploymentRecord,
  removeDeploymentRecord,
  getLocalDeployments
} = require('../lib/tracker');

const {
  issueDeviceCredentials,
  resetFailedAuth
} = require('../lib/auth');

const app = require('../server/server');

async function runNewFeaturesTestSuite() {
  console.log('====================================================');
  console.log('      NEW FEATURES VERIFICATION TEST SUITE          ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
    }
  }

  // 1. Template Generation Tests
  test('buildPausedPageHtml generates valid paused placeholder markup', () => {
    const html = buildPausedPageHtml('my-test-site', 'My Awesome Project');
    assert(html.includes('[PAUSED] Site Offline'), 'Must include [PAUSED] badge');
    assert(html.includes('my-test-site'), 'Must include slug identifier');
    assert(html.includes('My Awesome Project'), 'Must include title');
    assert(html.includes('#FF3B00'), 'Must include orange brand accent');
  });

  test('buildRedirectPageHtml generates valid redirect markup', () => {
    const html = buildRedirectPageHtml('https://new-destination.pages.dev', 'new-destination');
    assert(html.includes('http-equiv="refresh"'), 'Must include meta http-equiv refresh');
    assert(html.includes('url=https://new-destination.pages.dev'), 'Must refresh to target URL');
    assert(html.includes('https://new-destination.pages.dev'), 'Must include fallback anchor tag');
  });

  // 2. Data Store Helper Tests
  await asyncTest('tracker.js getDeploymentRecord and updateDeploymentRecord work atomically', async () => {
    const testSlug = `unit-test-${Date.now()}`;
    const initial = await saveDeploymentRecord({
      slug: testSlug,
      title: 'Unit Test Initial',
      template: 'landing',
      mode: 'branch',
      url: `https://${testSlug}.pages.dev`,
      isSimulation: true,
      status: 'active'
    });

    assert.strictEqual(initial.status, 'active');
    assert.strictEqual(initial.redeployCount, 0);

    const fetched = getDeploymentRecord(testSlug);
    assert(fetched, 'Record must be found by slug');
    assert.strictEqual(fetched.slug, testSlug);

    const updated = await updateDeploymentRecord(testSlug, {
      status: 'paused',
      pausedAt: new Date().toISOString(),
      redeployCount: 1
    });

    assert.strictEqual(updated.status, 'paused');
    assert(updated.pausedAt, 'pausedAt must be set');
    assert.strictEqual(updated.redeployCount, 1);

    // Clean up
    await removeDeploymentRecord(testSlug);
  });

  // 3. API Integration Tests (using ephemeral test server)
  let testServer = null;
  let baseUrl = '';

  await asyncTest('Integration: Spin up test server and register test device', async () => {
    testServer = await new Promise(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${testServer.address().port}`;
    assert(baseUrl.includes('http://127.0.0.1:'));
  });

  resetFailedAuth('198.51.100.99');
  resetFailedAuth('127.0.0.1');
  const { deviceId, secret } = issueDeviceCredentials();
  const host = `127.0.0.1:${testServer.address().port}`;
  const authHeaders = {
    'Content-Type': 'application/json',
    'X-Device-Id': deviceId,
    'X-Device-Secret': secret,
    'Cookie': `device_secret=${secret}`,
    'Origin': baseUrl,
    'Host': host,
    'X-Forwarded-For': '198.51.100.99'
  };

  const integrationSlug = `integ-${Date.now().toString(36)}`;

  // Create an initial deployment
  await asyncTest('API: Create initial simulation deployment', async () => {
    const res = await fetch(`${baseUrl}/api/deployments/generate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customSlug: integrationSlug,
        title: 'Initial Integration Site',
        mode: 'branch',
        dryRun: true,
        files: [
          { name: 'index.html', path: 'index.html', content: '<h1>Hello v1</h1>', size: 20 }
        ]
      })
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${data.error}`);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.slug, integrationSlug);
  });

  // Test Pause API
  await asyncTest('API: POST /api/deployments/:slug/pause sets status to paused', async () => {
    const res = await fetch(`${baseUrl}/api/deployments/${integrationSlug}/pause`, {
      method: 'POST',
      headers: authHeaders
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${data.error}`);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.deployment.status, 'paused');
    assert(data.deployment.pausedAt, 'pausedAt must be recorded');
  });

  // Test Resume API
  await asyncTest('API: POST /api/deployments/:slug/resume restores status to active', async () => {
    const res = await fetch(`${baseUrl}/api/deployments/${integrationSlug}/resume`, {
      method: 'POST',
      headers: authHeaders
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${data.error}`);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.deployment.status, 'active');
    assert.strictEqual(data.deployment.pausedAt, null);
  });

  // Test Redeploy API (same slug, updated files)
  await asyncTest('API: POST /api/deployments/:slug/redeploy updates files and increments redeployCount', async () => {
    const res = await fetch(`${baseUrl}/api/deployments/${integrationSlug}/redeploy`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Updated Integration Site v2',
        files: [
          { name: 'index.html', path: 'index.html', content: '<h1>Hello v2 Updated</h1>', size: 28 }
        ]
      })
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${data.error}`);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.deployment.slug, integrationSlug);
    assert.strictEqual(data.deployment.redeployCount, 1);
    assert(data.deployment.lastRedeployedAt, 'lastRedeployedAt must be timestamped');
  });

  // Test Redeploy API with URL rename option (newSlug)
  const renamedSlug = `${integrationSlug}-renamed`;
  await asyncTest('API: POST /api/deployments/:slug/redeploy with newSlug updates URL and tracks originalSlug', async () => {
    const res = await fetch(`${baseUrl}/api/deployments/${integrationSlug}/redeploy`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        newSlug: renamedSlug,
        title: 'Renamed Integration Site v3',
        files: [
          { name: 'index.html', path: 'index.html', content: '<h1>Hello v3 Renamed</h1>', size: 28 }
        ]
      })
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${data.error}`);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.deployment.slug, renamedSlug);
    assert.strictEqual(data.deployment.originalSlug, integrationSlug);
    assert.strictEqual(data.deployment.redeployCount, 2);
  });

  // Test Collision Error on URL rename
  await asyncTest('API: POST /api/deployments/:slug/redeploy rejects duplicate newSlug with 400', async () => {
    // Attempt to redeploy another record using the already taken renamedSlug
    const anotherSlug = `another-${Date.now().toString(36)}`;
    await saveDeploymentRecord({
      slug: anotherSlug,
      title: 'Another',
      url: `https://${anotherSlug}.pages.dev`,
      deviceId,
      isSimulation: true
    });

    const res = await fetch(`${baseUrl}/api/deployments/${anotherSlug}/redeploy`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        newSlug: renamedSlug,
        files: []
      })
    });

    const data = await res.json();
    assert.strictEqual(res.status, 400, 'Should reject taken slug with 400');
    assert(data.error.includes('already taken'));

    await removeDeploymentRecord(anotherSlug, deviceId);
  });

  // 11. Project Name Column & Mandatory Configuration Tests
  await asyncTest('tracker.js saveDeploymentRecord stores and preserves projectName', async () => {
    const slugWithProj = `proj-test-${Date.now()}`;
    const rec = await saveDeploymentRecord({
      slug: slugWithProj,
      projectName: 'custom-team-project',
      title: 'Project Test',
      url: `https://${slugWithProj}.custom-team-project.pages.dev`,
      isSimulation: true
    });

    assert.strictEqual(rec.projectName, 'custom-team-project', 'Must record custom projectName');
    const fetched = getDeploymentRecord(slugWithProj);
    assert.strictEqual(fetched.projectName, 'custom-team-project', 'Must persist projectName in store');
    await removeDeploymentRecord(slugWithProj);
  });

  await asyncTest('API: POST /api/config rejects empty or whitespace projectName with 400', async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        projectName: '   '
      })
    });

    assert.strictEqual(res.status, 400, 'Must return HTTP 400 for empty project name');
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert(data.error.includes('Project name is mandatory'), 'Error message must specify mandatory project name');
  });

  await asyncTest('API: GET /api/deployments includes projectName for every deployment', async () => {
    const res = await fetch(`${baseUrl}/api/deployments`, {
      headers: authHeaders
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(data.deployments));
    for (const d of data.deployments) {
      assert(typeof d.projectName === 'string' && d.projectName.length > 0, `Record ${d.slug} must have a valid projectName`);
    }
  });

  // Clean up test records
  await removeDeploymentRecord(renamedSlug, deviceId);

  if (testServer) {
    testServer.close();
  }

  console.log('\n====================================================');
  console.log(`Total New Features Tests: ${total}`);
  console.log(`Passed:                  ${passed}`);
  console.log(`Failed:                  ${total - passed}`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runNewFeaturesTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
