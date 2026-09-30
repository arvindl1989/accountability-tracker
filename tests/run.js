/* Serves the app on a free port, runs the UI checks against it, then stops. */
const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8123;

const server = spawn(process.execPath,
  [path.join(root, 'node_modules', 'http-server', 'bin', 'http-server'), root, '-p', String(PORT), '-s', '-c-1'],
  { stdio: 'inherit' });

const stop = code => { server.kill(); process.exit(code); };
process.on('SIGINT', () => stop(130));

const SUITES = ['ui.test.js', 'share.test.js', 'sync.test.js'];

function runSuite(i, failed) {
  if (i === SUITES.length) return stop(failed ? 1 : 0);
  const test = spawn(process.execPath, [path.join(__dirname, SUITES[i])], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { BASE_URL: `http://127.0.0.1:${PORT}/index.html` })
  });
  test.on('exit', code => runSuite(i + 1, failed || code !== 0));
}

setTimeout(() => runSuite(0, false), 1200);
