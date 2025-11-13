# Feature Deep Dive

## Tabs and context menu

1. Open multiple files to confirm tab switching.
2. Right-click links to ensure the context menu includes "Copy Link" and Mermaid zoom actions when relevant.

### Mixed content

Paragraphs can include inline math-like spans such as `sum += value`, and also reference URLs like https://example.org.

```
No language fence: confirm default styling is applied,
and Prism does not crash without a language class.
```

```json
{
  "name": "markdownviewer",
  "features": ["mermaid", "rehype-prism", "remark-gfm"],
  "tabs": [
    { "title": "File.md", "active": true },
    { "title": "Remote.md", "active": false }
  ]
}
```

### Task list (GFM)

- [x] Inline code fallback
- [ ] Mermaid zoom from context menu
- [x] Syntax highlighting for JSON
- [ ] Verify table borders in dark mode

### Quote with code

> Remember: `window.api.openExternal(url)` launches the system browser.
