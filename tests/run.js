/* Serves the app on a free port, waits until it actually answers, runs each
 * suite against it, then stops. Picking the port at run time means two runs
 * can overlap without fighting over one. */
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SUITES = ['ui.test.js', 'identity.test.js', 'share.test.js', 'sync.test.js', 'diagnose.test.js', 'server.test.js'];

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForServer(port, tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      const req = http.get({ host: '127.0.0.1', port, path: '/index.html' }, res => {
        res.resume();
        res.statusCode === 200 ? resolve() : retry(n);
      });
      req.on('error', () => retry(n));
      req.setTimeout(500, () => { req.destroy(); retry(n); });
    };
    const retry = n =>
      n <= 0 ? reject(new Error('the test server never came up')) : setTimeout(() => attempt(n - 1), 100);
    attempt(tries);
  });
}

(async () => {
  const PORT = process.env.PORT || (await freePort());
  const server = spawn(process.execPath,
    [path.join(root, 'node_modules', 'http-server', 'bin', 'http-server'), root,
     '-p', String(PORT), '-s', '-c-1', '-a', '127.0.0.1'],
    { stdio: 'inherit' });

  const stop = code => { server.kill(); process.exit(code); };
  process.on('SIGINT', () => stop(130));
  server.on('exit', c => { if (c !== null && c !== 0) { console.error(`server exited (${c})`); process.exit(1); } });

  try {
    await waitForServer(PORT);
  } catch (e) {
    console.error(e.message);
    return stop(1);
  }

  let failed = false;
  for (const suite of SUITES) {
    const code = await new Promise(resolve => {
      const t = spawn(process.execPath, [path.join(__dirname, suite)], {
        stdio: 'inherit',
        env: Object.assign({}, process.env, { BASE_URL: `http://127.0.0.1:${PORT}/index.html` })
      });
      t.on('exit', resolve);
    });
    if (code !== 0) failed = true;      // keep going: one broken suite should not hide the rest
  }
  stop(failed ? 1 : 0);
})();
