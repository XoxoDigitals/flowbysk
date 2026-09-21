const fs = require('fs');
const path = require('path');
const db = require('./db');

const UPLOADS_ROOT = path.join(__dirname, 'uploads', 'downloads');
const PLATFORM_DIRS = {
  windows: path.join(UPLOADS_ROOT, 'windows'),
  android: path.join(UPLOADS_ROOT, 'android'),
};

const ALLOWED_EXT = {
  windows: ['.exe', '.zip', '.msi'],
  android: ['.apk', '.aab'],
};

const STORED_BASENAME = {
  windows: 'flow-windows',
  android: 'flow-android',
};

function ensureDirs() {
  for (const dir of Object.values(PLATFORM_DIRS)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(__dirname, 'uploads', 'tmp'), { recursive: true });
}

function sanitizeOriginalName(name, platform) {
  const base = path.basename(String(name || 'package')).replace(/[^\w.\- ()[\]]+/g, '_');
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXT[platform].includes(ext)) return null;
  return base || `package${ext}`;
}

async function getDownloadsMeta() {
  const settings = (await db.getSettings()) || {};
  const downloads = settings.downloads && typeof settings.downloads === 'object' ? settings.downloads : {};
  return {
    windows: downloads.windows || null,
    android: downloads.android || null,
  };
}

function publicMeta(entry) {
  if (!entry || !entry.originalName) return null;
  return {
    originalName: entry.originalName,
    size: Number(entry.size) || 0,
    updatedAt: entry.updatedAt || null,
    contentType: entry.contentType || null,
  };
}

function resolveExisting(entry, platform) {
  if (!entry || !entry.storedName) return null;
  const full = path.join(PLATFORM_DIRS[platform], entry.storedName);
  if (!fs.existsSync(full)) return null;
  return full;
}

async function getPublicAvailability() {
  const meta = await getDownloadsMeta();
  return {
    windows: resolveExisting(meta.windows, 'windows') ? publicMeta(meta.windows) : null,
    android: resolveExisting(meta.android, 'android') ? publicMeta(meta.android) : null,
  };
}

function contentTypeFor(ext, platform) {
  if (ext === '.exe') return 'application/vnd.microsoft.portable-executable';
  if (ext === '.msi') return 'application/x-msi';
  if (ext === '.zip') return 'application/zip';
  if (ext === '.apk') return 'application/vnd.android.package-archive';
  if (ext === '.aab') return 'application/octet-stream';
  return platform === 'windows'
    ? 'application/octet-stream'
    : 'application/vnd.android.package-archive';
}

async function saveUploadedFile(platform, file) {
  if (!PLATFORM_DIRS[platform]) throw new Error('Invalid platform');
  if (!file) throw new Error('No file uploaded');

  const originalName = sanitizeOriginalName(file.originalname, platform);
  if (!originalName) {
    throw new Error(
      platform === 'windows'
        ? 'Windows package must be .exe, .zip, or .msi'
        : 'Android package must be .apk or .aab'
    );
  }

  ensureDirs();
  const ext = path.extname(originalName).toLowerCase();
  const storedName = `${STORED_BASENAME[platform]}${ext}`;
  const dest = path.join(PLATFORM_DIRS[platform], storedName);

  for (const existing of fs.readdirSync(PLATFORM_DIRS[platform])) {
    const full = path.join(PLATFORM_DIRS[platform], existing);
    if (fs.statSync(full).isFile()) fs.unlinkSync(full);
  }

  if (file.path && fs.existsSync(file.path)) {
    fs.renameSync(file.path, dest);
  } else if (file.buffer) {
    fs.writeFileSync(dest, file.buffer);
  } else {
    throw new Error('Upload buffer missing');
  }

  const size = fs.statSync(dest).size;
  const entry = {
    originalName,
    storedName,
    size,
    updatedAt: new Date().toISOString(),
    contentType: contentTypeFor(ext, platform),
  };

  const current = await getDownloadsMeta();
  await db.updateSettings({
    downloads: {
      ...current,
      [platform]: entry,
    },
  });

  return publicMeta(entry);
}

async function removePackage(platform) {
  if (!PLATFORM_DIRS[platform]) throw new Error('Invalid platform');
  ensureDirs();
  for (const existing of fs.readdirSync(PLATFORM_DIRS[platform])) {
    const full = path.join(PLATFORM_DIRS[platform], existing);
    if (fs.statSync(full).isFile()) fs.unlinkSync(full);
  }
  const current = await getDownloadsMeta();
  await db.updateSettings({
    downloads: {
      ...current,
      [platform]: null,
    },
  });
  return true;
}

async function streamPackage(platform, res) {
  const meta = (await getDownloadsMeta())[platform];
  const full = resolveExisting(meta, platform);
  if (!full || !meta) {
    return res.status(404).json({
      success: false,
      error:
        platform === 'windows'
          ? 'Windows package is not available yet'
          : 'Android package is not available yet',
    });
  }
  if (meta.contentType) res.type(meta.contentType);
  return res.download(full, meta.originalName);
}

module.exports = {
  UPLOADS_ROOT,
  PLATFORM_DIRS,
  ALLOWED_EXT,
  ensureDirs,
  getDownloadsMeta,
  getPublicAvailability,
  publicMeta,
  saveUploadedFile,
  removePackage,
  streamPackage,
};
