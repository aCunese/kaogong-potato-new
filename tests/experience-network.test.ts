import { expect, it } from 'bun:test';
import { createServer } from 'node:http';
it('bounds a real HTTP response whose body never finishes and preserves normal error responses', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/stall') { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); return; }
    res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"ok":false}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as any;
  try {
    const { fetchWithDeadline } = await import('../src/utils/networkRequest');
    await expect(fetchWithDeadline(`http://127.0.0.1:${address.port}/stall`, {}, 40)).rejects.toMatchObject({ name: 'TimeoutError' });
    const response = await fetchWithDeadline(`http://127.0.0.1:${address.port}/fail`, {}, 1000);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false });
    const cancelled = new AbortController(); cancelled.abort();
    await expect(fetchWithDeadline(`http://127.0.0.1:${address.port}/stall`, { signal: cancelled.signal }, 1000)).rejects.toMatchObject({ name: 'AbortError' });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
