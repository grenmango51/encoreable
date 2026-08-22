import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Provision to ensure config exists
import './provision-local-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_DIR = path.join(process.cwd(), 'runtime');
const configPath = path.join(RUNTIME_DIR, 'config', 'config.js');

if (fs.existsSync(configPath)) {
  const content = fs.readFileSync(configPath, 'utf-8');
  if (!content.includes("'127.0.0.1'") && !content.includes('"127.0.0.1"')) {
    console.error('FAIL: bindaddress is not 127.0.0.1');
    process.exit(1);
  }
} else {
  console.error('FAIL: config.js not found.');
  process.exit(1);
}

// Test format loading dynamically from the provisioned runtime
import('file://' + path.join(RUNTIME_DIR, 'dist', 'sim', 'dex.js')).then((mod) => {
  const Dex = mod.default.Dex;
  const format = Dex.formats.get('gen9championsvgc2026regmb');
  if (!format.exists) {
    console.error('FAIL: Format gen9championsvgc2026regmb not found in the simulator.');
    process.exit(1);
  }
  console.log('PASS: loopback configuration and format verification successful.');
  process.exit(0);
}).catch(err => {
  console.error('Error verifying format:', err);
  process.exit(1);
});
