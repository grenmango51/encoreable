import fs from 'fs';
import path from 'path';

const PID_FILE = path.join(process.cwd(), 'runtime', 'pids.json');

if (fs.existsSync(PID_FILE)) {
  try {
    const pids = JSON.parse(fs.readFileSync(PID_FILE, 'utf-8'));
    if (pids.server) {
      try { process.kill(pids.server); console.log(`Killed server (PID ${pids.server})`); } catch (e) {}
    }
    if (pids.launcher) {
      try { process.kill(pids.launcher); console.log(`Killed launcher (PID ${pids.launcher})`); } catch (e) {}
    }
    fs.unlinkSync(PID_FILE);
  } catch (err) {
    console.error('Error stopping processes:', err);
  }
} else {
  console.log('No pids.json found. Is the local server running?');
}
