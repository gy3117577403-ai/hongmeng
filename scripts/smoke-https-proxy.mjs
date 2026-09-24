import { createServer } from 'node:https';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';

if (process.env.SAMPLE_LIBRARY_QA_ALLOW !== 'disposable-sample-library') throw Error('Disposable runtime required');
const upstream = new URL(process.env.SMOKE_HTTPS_UPSTREAM || 'http://127.0.0.1:3000');
if (upstream.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(upstream.hostname)) throw Error('Loopback HTTP upstream required');
const port = Number(process.env.SMOKE_HTTPS_PORT || 3443);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid test port');
const server = createServer({ key: readFileSync(process.env.SMOKE_HTTPS_KEY), cert: readFileSync(process.env.SMOKE_HTTPS_CERT) }, (incoming, outgoing) => {
  const host = '127.0.0.1:' + port;
  const forwarded = request({
    hostname: upstream.hostname, port: upstream.port || 80, path: incoming.url, method: incoming.method,
    headers: { ...incoming.headers, host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' },
  }, response => {
    outgoing.writeHead(response.statusCode || 502, response.headers);
    response.pipe(outgoing);
  });
  forwarded.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end('Disposable upstream unavailable'); });
  incoming.on('aborted', () => forwarded.destroy());
  incoming.pipe(forwarded);
});
server.listen(port, '127.0.0.1', () => console.log('Disposable HTTPS ready on loopback port ' + port));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
