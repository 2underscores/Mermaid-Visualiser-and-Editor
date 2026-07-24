import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, 'projects');
const PORT = process.env.PORT || 4400;

const app = express();
app.use(express.json({ limit: '2mb' }));

// Serve the UI and mermaid's ESM bundle (so the app works offline)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/mermaid', express.static(path.join(__dirname, 'node_modules', 'mermaid', 'dist')));

const VERSION_RE = /^v(\d+)\.(mermaid|mmd)$/;

async function listVersions(projectName) {
  const dir = path.join(PROJECTS_DIR, projectName);
  const entries = await fsp.readdir(dir).catch(() => []);
  return entries
    .map((f) => {
      const m = f.match(VERSION_RE);
      return m ? { file: f, version: Number(m[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);
}

async function listProjects() {
  const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => []);
  const projects = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const versions = await listVersions(e.name);
    if (versions.length === 0) continue;
    const latest = versions[versions.length - 1];
    const stat = await fsp.stat(path.join(PROJECTS_DIR, e.name, latest.file));
    projects.push({
      name: e.name,
      latestVersion: latest.version,
      versions: versions.map((v) => v.version),
      updatedAt: stat.mtimeMs,
    });
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}

function safeProjectDir(name) {
  if (!/^[\w][\w .-]*$/.test(name)) return null;
  const dir = path.join(PROJECTS_DIR, name);
  if (!dir.startsWith(PROJECTS_DIR + path.sep)) return null;
  return dir;
}

async function versionFile(projectName, version) {
  const versions = await listVersions(projectName);
  const match =
    version === 'latest'
      ? versions[versions.length - 1]
      : versions.find((v) => v.version === Number(version));
  return match ? path.join(PROJECTS_DIR, projectName, match.file) : null;
}

app.get('/api/projects', async (req, res) => {
  res.json(await listProjects());
});

app.get('/api/projects/:name/versions/:version', async (req, res) => {
  const dir = safeProjectDir(req.params.name);
  if (!dir) return res.status(400).json({ error: 'invalid project name' });
  const file = await versionFile(req.params.name, req.params.version);
  if (!file) return res.status(404).json({ error: 'not found' });
  const content = await fsp.readFile(file, 'utf8');
  const version = Number(path.basename(file).match(VERSION_RE)[1]);
  res.json({ name: req.params.name, version, content });
});

// Save: overwrite an existing version's file
app.put('/api/projects/:name/versions/:version', async (req, res) => {
  const dir = safeProjectDir(req.params.name);
  if (!dir) return res.status(400).json({ error: 'invalid project name' });
  const file = await versionFile(req.params.name, req.params.version);
  if (!file) return res.status(404).json({ error: 'not found' });
  if (typeof req.body?.content !== 'string') return res.status(400).json({ error: 'content required' });
  await fsp.writeFile(file, req.body.content, 'utf8');
  res.json({ ok: true });
});

// Create a new version (or a new project when it doesn't exist yet)
app.post('/api/projects/:name/versions', async (req, res) => {
  const dir = safeProjectDir(req.params.name);
  if (!dir) return res.status(400).json({ error: 'invalid project name' });
  if (typeof req.body?.content !== 'string') return res.status(400).json({ error: 'content required' });
  await fsp.mkdir(dir, { recursive: true });
  const versions = await listVersions(req.params.name);
  const next = versions.length ? versions[versions.length - 1].version + 1 : 1;
  await fsp.writeFile(path.join(dir, `v${next}.mermaid`), req.body.content, 'utf8');
  res.json({ ok: true, version: next });
});

// ---- Live updates: watch the projects tree, broadcast over SSE ----
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  sseClients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

let debounceTimer = null;
function broadcastChange(filename) {
  // Debounce bursts of fs events (editors often write multiple times)
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const payload = `data: ${JSON.stringify({ type: 'change', file: filename || null, ts: Date.now() })}\n\n`;
    for (const client of sseClients) client.write(payload);
  }, 120);
}

fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.watch(PROJECTS_DIR, { recursive: true }, (event, filename) => broadcastChange(filename));

app.listen(PORT, () => {
  console.log(`mermaid-visualiser running at http://localhost:${PORT}`);
});
