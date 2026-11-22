/**
 * MongoDB connectivity diagnostic:  npm run db:check
 * Checks, step by step: connection-string format → DNS (SRV/TXT/A) → TCP port 27017 → TLS handshake → login.
 * Credentials are never printed.
 */
import dns from 'dns/promises';
import net from 'net';
import tls from 'tls';
import mongoose from 'mongoose';
import { env } from '../src/config/env.config';
import { inspectMongoUri, explainConnectionError, redactUri } from '../src/config/db.config';

const ok = (s: string) => console.log(`  ✔ ${s}`);
const bad = (s: string) => console.log(`  ✘ ${s}`);
const info = (s: string) => console.log(`    ${s}`);

function tcp(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port, timeout: 6000 }, () => { sock.end(); resolve(); });
    sock.on('timeout', () => { sock.destroy(); reject(new Error('timed out (port blocked by firewall/Wi-Fi, or IP not allowed)')); });
    sock.on('error', reject);
  });
}

function tlsHandshake(host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host, timeout: 8000 }, () => { const p = sock.getProtocol() || 'TLS'; sock.end(); resolve(p); });
    sock.on('timeout', () => { sock.destroy(); reject(new Error('TLS handshake timed out')); });
    sock.on('error', reject);
  });
}

async function main() {
  const uri = env.MONGODB_URI;
  console.log(`\nMongoDB diagnostic for ${redactUri(uri)}\n`);

  console.log('1. Connection string');
  const r = inspectMongoUri(uri);
  r.errors.forEach(bad);
  r.warnings.forEach((w) => console.log(`  ! ${w}`));
  if (!r.errors.length) ok(`${r.scheme}:// · ${r.hosts.length} host(s) · database "${r.database || 'test (default)'}"`);

  console.log('\n2. DNS');
  let hosts = r.hosts.map((h) => { const [name, port] = h.split(':'); return { name, port: Number(port || 27017) }; });
  if (r.isSrv) {
    try {
      const srv = await dns.resolveSrv(`_mongodb._tcp.${hosts[0].name}`);
      hosts = srv.map((s) => ({ name: s.name, port: s.port }));
      ok(`SRV record → ${hosts.map((h) => h.name).join(', ')}`);
      const txt = (await dns.resolveTxt(r.hosts[0].split(':')[0]).catch(() => [] as string[][])).flat();
      if (txt.length) info(`TXT options: ${txt.join('&')}`);
    } catch (e: any) {
      bad(`SRV lookup failed (${e.code || e.message}). Your DNS cannot resolve mongodb+srv records → set DNS to 8.8.8.8 / 1.1.1.1 or use the standard connection string.`);
    }
  }
  for (const h of hosts) {
    try { ok(`${h.name} → ${(await dns.lookup(h.name)).address}`); } catch (e: any) { bad(`${h.name} → ${e.code || e.message}`); }
  }

  console.log('\n3. Network (TCP + TLS)');
  for (const h of hosts) {
    try {
      await tcp(h.name, h.port);
      ok(`TCP ${h.name}:${h.port} open`);
      if (r.isAtlas) {
        try { ok(`TLS handshake OK (${await tlsHandshake(h.name, h.port)})`); } catch (e: any) { bad(`TLS failed: ${e.message}`); }
      }
    } catch (e: any) {
      bad(`TCP ${h.name}:${h.port} → ${e.code || e.message}`);
    }
  }

  console.log('\n4. Login & server selection');
  if (r.errors.length) {
    bad('Skipped — fix the connection-string errors above first.');
  } else {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, appName: 'autoflow-ai-dbcheck' });
      const ping = await mongoose.connection.db!.admin().ping();
      ok(`Connected and authenticated (database "${mongoose.connection.name}", ping ${JSON.stringify(ping)})`);
    } catch (e: any) {
      bad(redactUri(e.message));
      console.log(`\n  Likely cause:\n  ${explainConnectionError(e, r).replace(/\n/g, '\n  ')}`);
    } finally {
      await mongoose.disconnect().catch(() => null);
    }
  }
  console.log('');
  process.exit(0);
}

main();
