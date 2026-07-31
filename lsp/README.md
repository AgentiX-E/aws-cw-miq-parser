# CloudWatch Metrics Insights Language Server

A lightweight [LSP](https://microsoft.github.io/language-server-protocol/) server for CloudWatch Metrics Insights (MIQ) queries. Provides real-time diagnostics, autocompletion, and hover information in any LSP-compatible editor.

## Features

- **Real-time diagnostics**: Syntax errors with source locations shown as editor squiggles
- **Autocompletion**: Context-aware suggestions for keywords, functions, operators, and special tokens
- **Hover information**: AST node details on hover (SELECT function, FROM namespace, WHERE conditions, etc.)
- **Zero runtime dependencies**: No `vscode-languageserver` package needed — pure Node.js stdio JSON-RPC

## Editor Integration

### VS Code

Add to your VS Code `settings.json`:

```json
{
  "miq.server.path": "npx cw-miq-lsp"
}
```

Or use the bundled extension configuration:

```bash
# Copy the extension config to your project
cp .vscode/extensions.json.example .vscode/extensions.json
```

For `.miq` file association, add to `settings.json`:

```json
{
  "files.associations": {
    "*.miq": "sql"
  }
}
```

### Neovim (with nvim-lspconfig)

```lua
local lspconfig = require('lspconfig')
lspconfig.cw_miq = {
  cmd = { 'npx', 'cw-miq-lsp' },
  filetypes = { 'miq', 'sql' },
}
```

### Helix

```toml
[[language]]
name = "miq"
language-servers = ["cw-miq-lsp"]

[language-server.cw-miq-lsp]
command = "npx"
args = ["cw-miq-lsp"]
```

### Emacs (with lsp-mode)

```elisp
(lsp-register-client
  (make-lsp-client
    :new-connection (lsp-stdio-connection '("npx" "cw-miq-lsp"))
    :activation-fn (lsp-activate-on "miq")
    :server-id 'cw-miq-lsp))
```

## Protocol Support

| Capability | Status | Description |
|-----------|--------|-------------|
| `textDocument/didOpen` | ✅ | Parse on open, publish diagnostics |
| `textDocument/didChange` | ✅ | Re-parse on change, publish diagnostics |
| `textDocument/didClose` | ✅ | Clear diagnostics on close |
| `textDocument/completion` | ✅ | Keyword, function, operator, and special token completions |
| `textDocument/hover` | ✅ | AST node information at cursor position |
| `textDocument/formatting` | ❌ | Not yet — use `cw-miq format` CLI instead |
| `textDocument/codeAction` | ❌ | Not yet |
