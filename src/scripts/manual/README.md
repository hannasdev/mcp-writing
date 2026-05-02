# Manual Script Conventions

Manual scripts under this folder should use `mcp-result.mjs` for MCP tool parsing.

## Use the shared parser

Import and call:

```js
import { callToolParsed } from "./mcp-result.mjs";

const result = await callToolParsed(client, "get_scene_prose", { scene_id: "sc-001" });
```

`callToolParsed(...)` returns:

- `raw`: original MCP response object
- `text`: `raw.content?.[0]?.text ?? ""`
- `data`: parsed JSON object when `text` is valid JSON, otherwise `null`
- `structured`: `raw.structuredContent` (if present)
- `isError`: `true` when `raw.isError` is set or parsed `data.ok === false`

## Why this is required

Some tools now return advisory metadata in `structuredContent` (for example stale-metadata guidance on prose tools). Scripts that only read `content[0].text` can silently lose those warnings.

Using `callToolParsed` keeps text, JSON payloads, and structured metadata handled consistently across all manual scripts.
