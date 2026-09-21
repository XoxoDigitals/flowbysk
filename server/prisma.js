const path = require('path');
const fs = require('fs');

function resolveNextRoot() {
  const candidates = [
    path.join(__dirname, '..', 'dashboard'), // production Browser layout
    path.join(__dirname, '..', 'Google Flow v9', 'Google Flow'), // local Windows
    path.join(__dirname, '..'), // fallback
  ];
  for (const dir of candidates) {
    const prismaClient = path.join(dir, 'node_modules', '@prisma', 'client');
    if (fs.existsSync(prismaClient)) return dir;
  }
  return candidates[0];
}

const NEXT_ROOT = resolveNextRoot();
const ENV_PATHS = [
  path.join(__dirname, '..', '.env'),
  path.join(NEXT_ROOT, '.env'),
  path.join(__dirname, '.env'),
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

for (const envPath of ENV_PATHS) loadEnvFile(envPath);

const { PrismaClient } = require(path.join(NEXT_ROOT, 'node_modules', '@prisma', 'client'));

const globalForPrisma = globalThis;
const prisma =
  globalForPrisma.__flowPrisma ||
  new PrismaClient({
    log: process.env.PRISMA_LOG === '1' ? ['error', 'warn'] : ['error'],
  });
if (!globalForPrisma.__flowPrisma) globalForPrisma.__flowPrisma = prisma;

module.exports = { prisma, NEXT_ROOT };
