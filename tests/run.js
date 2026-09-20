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

setTimeout(() => {
  const test = spawn(process.execPath, [path.join(__dirname, 'ui.test.js')], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { BASE_URL: `http://127.0.0.1:${PORT}/index.html` })
  });
  test.on('exit', stop);
}, 1200);
