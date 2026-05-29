const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3456;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const META_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let files = [];
if (fs.existsSync(META_FILE)) {
  try { files = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch(e) { files = []; }
}

function saveMeta() {
  fs.writeFileSync(META_FILE, JSON.stringify(files, null, 2), 'utf8');
}

function serveFile(res, filePath, mime) {
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=86400'
  });
  fs.createReadStream(filePath).pipe(res);
}

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime'
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');

  // ── Serve uploaded files ──
  if (url.pathname.startsWith('/uploads/')) {
    const filename = url.pathname.replace('/uploads/', '');
    const filePath = path.join(UPLOAD_DIR, filename);
    const ext = path.extname(filename).toLowerCase();
    serveFile(res, filePath, MIME[ext] || 'application/octet-stream');
    return;
  }

  // ── List all files ──
  if (req.method === 'GET' && url.pathname === '/api/files') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(files));
    return;
  }

  // ── Upload ──
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const boundary = req.headers['content-type'].split('boundary=')[1];
      if (!boundary) { res.writeHead(400); res.end('No boundary'); return; }

      const boundaryBuffer = Buffer.from('--' + boundary);
      const parts = [];
      let start = buffer.indexOf(boundaryBuffer) + boundaryBuffer.length + 2;
      while (start < buffer.length) {
        const end = buffer.indexOf(boundaryBuffer, start);
        if (end === -1) break;
        parts.push(buffer.slice(start, end > 2 ? end - 2 : end));
        start = end + boundaryBuffer.length + 2;
      }

      let savedFile = null;
      for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const header = part.slice(0, headerEnd).toString();
        const body = part.slice(headerEnd + 4);

        const filenameMatch = header.match(/filename="(.+?)"/);
        if (!filenameMatch) continue;
        const originalName = filenameMatch[1];

        const contentTypeMatch = header.match(/Content-Type: (.+)/);
        const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';

        const ext = path.extname(originalName) || '.bin';
        const id = Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
        const savedName = id + ext;
        fs.writeFileSync(path.join(UPLOAD_DIR, savedName), body);

        savedFile = {
          id, name: originalName, type: contentType, size: body.length,
          url: '/uploads/' + savedName, createdAt: Date.now()
        };
      }

      if (savedFile) {
        files.unshift(savedFile);
        saveMeta();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(savedFile));
      } else {
        res.writeHead(400); res.end('No file found');
      }
    });
    return;
  }

  // ── Delete ──
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/files/')) {
    const id = url.pathname.replace('/api/files/', '');
    const idx = files.findIndex(f => f.id === id);
    if (idx === -1) { res.writeHead(404); res.end('Not found'); return; }
    const file = files[idx];
    const filePath = path.join(UPLOAD_DIR, path.basename(file.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    files.splice(idx, 1);
    saveMeta();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Delete all ──
  if (req.method === 'DELETE' && url.pathname === '/api/files') {
    files.forEach(f => {
      const fp = path.join(UPLOAD_DIR, path.basename(f.url));
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    files = [];
    saveMeta();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Serve static HTML ──
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});
