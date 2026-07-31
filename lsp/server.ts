// LSP (Language Server Protocol) server for CloudWatch Metrics Insights queries.
//
// Provides real-time diagnostics (parse errors with source locations),
// completions (keywords, functions, operators), and hover information
// for .miq files via stdio-based JSON-RPC transport.
//
// Usage:
//   npx cw-miq-lsp              Start the language server on stdio
//   npx cw-miq-lsp --node-ipc   Start using Node IPC transport
//
// VS Code integration: add to settings.json:
//   "miq.server.path": "npx cw-miq-lsp"

import { parse } from '../source/parser.js';
import { getCompletions } from '../source/autocomplete.js';
import type { CompletionContext } from '../source/autocomplete.js';
import type { ParseError } from '../source/types.js';

// ---- LSP JSON-RPC transport ----

let nextId = 1;

function send(message: Record<string, unknown>): void {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
}

function sendNotification(method: string, params?: Record<string, unknown>): void {
  send({ jsonrpc: '2.0', method, params });
}

function sendResponse(id: number | string, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id: number | string, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// ---- LSP message types ----

interface TextDocumentIdentifier {
  uri: string;
}

interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

interface Position {
  line: number;
  character: number;
}

interface Range {
  start: Position;
  end: Position;
}

interface Diagnostic {
  range: Range;
  severity: number;
  source: string;
  message: string;
  code?: string;
}

interface CompletionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

interface HoverParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

// ---- Document management ----

/** In-memory document store keyed by URI. */
const documents = new Map<string, TextDocumentItem>();

/** Convert our ParseError to an LSP Diagnostic. */
function errorToDiagnostic(error: ParseError, source: string): Diagnostic {
  const startLine = Math.max(0, error.location.start.line - 1);
  const startChar = Math.max(0, error.location.start.column - 1);
  const endLine = Math.max(0, error.location.end.line - 1);
  const endChar = Math.max(0, error.location.end.column - 1);

  return {
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    },
    severity: 1, // Error
    source: 'aws-cw-miq-parser',
    message: error.message,
    code: error.code,
  };
}

/** Convert position to offset in source. */
function positionToOffset(text: string, position: Position): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < position.line && i < lines.length; i++) {
    offset += lines[i]!.length + 1; // +1 for newline
  }
  return offset + Math.min(position.character, lines[position.line]?.length ?? 0);
}

// ---- Diagnostics ----

function publishDiagnostics(doc: TextDocumentItem): void {
  const diagnostics: Diagnostic[] = [];

  try {
    // Try full parse first — if it succeeds, no diagnostics
    parse(doc.text);
  } catch (err: any) {
    // If it throws a ParseError, convert to diagnostic
    if (err.location) {
      diagnostics.push(errorToDiagnostic(err as ParseError, doc.text));
    }
  }

  sendNotification('textDocument/publishDiagnostics', {
    uri: doc.uri,
    diagnostics,
  });
}

// ---- Message handlers ----

function handleInitialize(id: number | string, _params: Record<string, unknown>): void {
  sendResponse(id, {
    capabilities: {
      textDocumentSync: 1, // Full sync
      completionProvider: {
        triggerCharacters: [' ', '.', '(', '"', "'"],
      },
      hoverProvider: true,
    },
    serverInfo: {
      name: 'aws-cw-miq-parser-lsp',
      version: '0.1.0',
    },
  });
}

function handleCompletion(id: number | string, params: CompletionParams): void {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    sendResponse(id, []);
    return;
  }

  const textBefore = doc.text.slice(0, positionToOffset(doc.text, params.position));
  const context: CompletionContext = {
    textBeforeCursor: textBefore,
    fullText: doc.text,
    cursorOffset: positionToOffset(doc.text, params.position),
  };

  const items = getCompletions(context);
  const lspItems = items.map((item) => ({
    label: item.label,
    detail: item.detail,
    insertText: item.insertText,
    kind: item.kind === 'keyword' ? 14 :
          item.kind === 'function' ? 3 :
          item.kind === 'operator' ? 11 :
          item.kind === 'special' ? 1 : 1,
  }));

  sendResponse(id, lspItems);
}

function handleHover(id: number | string, params: HoverParams): void {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    sendResponse(id, null);
    return;
  }

  try {
    const ast = parse(doc.text);

    // Build a summary of the AST at the cursor position
    const offset = positionToOffset(doc.text, params.position);
    let info = '';

    if (offset < (ast.select.location?.start.offset ?? Infinity)) {
      info = '**Metrics Insights Query**';
    } else if (ast.where && offset >= (ast.where.location?.start.offset ?? 0) &&
               offset <= (ast.where.location?.end.offset ?? Infinity)) {
      info = `**WHERE clause** — ${ast.where.conditions.length} condition(s)`;
      for (const c of ast.where.conditions) {
        if (offset >= c.location.start.offset && offset <= c.location.end.offset) {
          info = `**WHERE condition**\n\n- Key: \`${c.labelKey}\`\n- Operator: \`${c.operator}\`\n- Value: \`${c.labelValue}\`\n- Tag filter: ${c.isTag ? 'yes' : 'no'}`;
        }
      }
    } else if (ast.groupBy && offset >= (ast.groupBy.location?.start.offset ?? 0)) {
      info = `**GROUP BY** — ${ast.groupBy.items.length} key(s)`;
    } else if (ast.orderBy && offset >= (ast.orderBy.location?.start.offset ?? 0)) {
      info = `**ORDER BY** — ${ast.orderBy.function}() ${ast.orderBy.direction}`;
    } else if (ast.limit && offset >= (ast.limit.location?.start.offset ?? 0)) {
      info = `**LIMIT** — ${ast.limit.value} time series`;
    } else if (ast.from.location && offset >= ast.from.location.start.offset) {
      info = `**FROM** — ${ast.from.namespace}${ast.from.type === 'SchemaFrom' ? ' (SCHEMA with ' + ast.from.dimensions.length + ' dimensions)' : ''}`;
    } else {
      info = `**SELECT** — ${ast.select.function}(\`${ast.select.metricName}\`)`;
    }

    sendResponse(id, {
      contents: {
        kind: 'markdown',
        value: info,
      },
    });
  } catch {
    sendResponse(id, null);
  }
}

function handleDidOpen(params: { textDocument: TextDocumentItem }): void {
  documents.set(params.textDocument.uri, params.textDocument);
  publishDiagnostics(params.textDocument);
}

function handleDidChange(params: {
  textDocument: TextDocumentIdentifier;
  contentChanges: { text: string }[];
}): void {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return;

  // Apply changes — full sync mode: replace entire content
  if (params.contentChanges.length > 0) {
    doc.text = params.contentChanges[params.contentChanges.length - 1]!.text;
    publishDiagnostics(doc);
  }
}

function handleDidClose(params: { textDocument: TextDocumentIdentifier }): void {
  documents.delete(params.textDocument.uri);
  // Clear diagnostics
  sendNotification('textDocument/publishDiagnostics', {
    uri: params.textDocument.uri,
    diagnostics: [],
  });
}

// ---- Main server loop ----

function startServer(): void {
  let buffer = '';

  process.stdin.on('readable', () => {
    let chunk: string | null;
    while ((chunk = process.stdin.read() as string | null) !== null) {
      buffer += chunk;

      // Extract complete LSP messages from buffer
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const headerPart = buffer.slice(0, headerEnd);
        const clMatch = headerPart.match(/Content-Length:\s*(\d+)/i);
        if (!clMatch) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }

        const contentLength = parseInt(clMatch[1]!, 10);
        const bodyStart = headerEnd + 4;

        if (buffer.length < bodyStart + contentLength) break;

        const body = buffer.slice(bodyStart, bodyStart + contentLength);
        buffer = buffer.slice(bodyStart + contentLength);

        try {
          handleMessage(body);
        } catch (err) {
          console.error('[cw-miq-lsp] Error handling message:', err);
        }
      }
    }
  });
}

function handleMessage(raw: string): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  const method = msg['method'] as string | undefined;
  const id = msg['id'] as number | string | undefined;
  const params = (msg['params'] ?? {}) as Record<string, unknown>;

  // Log incoming messages for debugging
  if (method !== 'textDocument/didChange') {
    console.error(`[cw-miq-lsp] ← ${method ?? '(response)'} id=${id ?? '–'}`);
  }

  switch (method) {
    case 'initialize':
      handleInitialize(id ?? '', params);
      break;
    case 'initialized':
      // No response needed
      break;
    case 'shutdown':
      sendResponse(id ?? '', null);
      break;
    case 'exit':
      process.exit(0);
      break;
    case 'textDocument/didOpen':
      handleDidOpen(params as unknown as { textDocument: TextDocumentItem });
      break;
    case 'textDocument/didChange':
      handleDidChange(params as unknown as {
        textDocument: TextDocumentIdentifier;
        contentChanges: { text: string }[];
      });
      break;
    case 'textDocument/didClose':
      handleDidClose(params as unknown as { textDocument: TextDocumentIdentifier });
      break;
    case 'textDocument/completion':
      handleCompletion(id ?? '', params as unknown as CompletionParams);
      break;
    case 'textDocument/hover':
      handleHover(id ?? '', params as unknown as HoverParams);
      break;
    default:
      // Unknown method — ignore gracefully
      break;
  }
}

// ---- Startup ----

// Log to stderr so stdout is clean for LSP transport
console.error('[cw-miq-lsp] Language server starting...');
startServer();
