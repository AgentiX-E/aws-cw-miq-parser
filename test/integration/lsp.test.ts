// Integration test for the LSP server.
// Tests the core diagnostic flow: initialize, didOpen (broken/valid), didClose.
// Note: Completion and hover tests are validated manually due to timing
// sensitivity in the vitest child process stdout capture.

import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const SERVER_PATH = resolve(__dirname, '..', '..', 'lsp', 'server.ts');

function createClient(): {
  send: (method: string, params?: Record<string, unknown>, isNotification?: boolean) => void;
  waitForResponse: (timeout?: number) => Promise<Record<string, unknown>>;
  waitForNotification: (method: string, timeout?: number) => Promise<Record<string, unknown>>;
  close: () => void;
} {
  const server = spawn('node', ['--import', 'tsx', SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  const queue: Record<string, unknown>[] = [];
  let nextId = 1;

  server.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const headerPart = buffer.slice(0, headerEnd);
      const clMatch = headerPart.match(/Content-Length:\s*(\d+)/i);
      if (!clMatch) { buffer = buffer.slice(headerEnd + 4); continue; }
      const cl = parseInt(clMatch[1]!, 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + cl) break;
      const body = buffer.slice(bodyStart, bodyStart + cl);
      buffer = buffer.slice(bodyStart + cl);
      try { queue.push(JSON.parse(body)); } catch { /* skip */ }
    }
  });

  function send(method: string, params?: Record<string, unknown>, isNotification = false): void {
    const msg: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (!isNotification) msg['id'] = nextId++;
    if (params) msg['params'] = params;
    const body = JSON.stringify(msg);
    server.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  async function waitForResponse(timeout = 3000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (queue.length > 0) return queue.shift()!;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timeout after ${timeout}ms`);
  }

  async function waitForNotification(method: string, timeout = 3000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const msg = await waitForResponse(Math.max(10, deadline - Date.now()));
      if (msg['method'] === method) return msg;
      queue.unshift(msg);
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timeout waiting for notification: ${method}`);
  }

  return { send, waitForResponse, waitForNotification, close: () => server.kill() };
}

describe('LSP Server', () => {
  it('initializes with expected capabilities', async () => {
    const client = createClient();
    client.send('initialize', { capabilities: {} });
    const resp = await client.waitForResponse();
    const caps = (resp['result'] as any).capabilities;
    expect(caps.textDocumentSync).toBe(1);
    expect(caps.completionProvider.triggerCharacters).toContain(' ');
    expect(caps.hoverProvider).toBe(true);
    client.close();
  }, 10000);

  it('publishes diagnostics for syntax errors', async () => {
    const client = createClient();
    client.send('initialize', { capabilities: {} });
    await client.waitForResponse();

    client.send('textDocument/didOpen', {
      textDocument: {
        uri: 'file:///broken.miq',
        languageId: 'miq',
        version: 1,
        text: 'SELECT FOO(x) FROM "AWS/EC2"',
      },
    }, true);

    const diag = await client.waitForNotification('textDocument/publishDiagnostics');
    const diagnostics = (diag['params'] as any).diagnostics as any[];
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe(1);
    expect(diagnostics[0].source).toBe('aws-cw-miq-parser');
    client.close();
  }, 10000);

  it('publishes empty diagnostics for valid queries', async () => {
    const client = createClient();
    client.send('initialize', { capabilities: {} });
    await client.waitForResponse();

    client.send('textDocument/didOpen', {
      textDocument: {
        uri: 'file:///valid.miq',
        languageId: 'miq',
        version: 1,
        text: 'SELECT AVG(CPUUtilization) FROM "AWS/EC2"',
      },
    }, true);

    const diag = await client.waitForNotification('textDocument/publishDiagnostics');
    expect((diag['params'] as any).diagnostics).toHaveLength(0);
    client.close();
  }, 10000);

  it('clears diagnostics on document close', async () => {
    const client = createClient();
    client.send('initialize', { capabilities: {} });
    await client.waitForResponse();

    client.send('textDocument/didOpen', {
      textDocument: {
        uri: 'file:///close.miq',
        languageId: 'miq',
        version: 1,
        text: 'INVALID',
      },
    }, true);

    const diag1 = await client.waitForNotification('textDocument/publishDiagnostics');
    expect((diag1['params'] as any).diagnostics.length).toBeGreaterThan(0);

    client.send('textDocument/didClose', {
      textDocument: { uri: 'file:///close.miq' },
    }, true);

    const diag2 = await client.waitForNotification('textDocument/publishDiagnostics');
    expect((diag2['params'] as any).diagnostics).toHaveLength(0);
    client.close();
  }, 10000);
});
