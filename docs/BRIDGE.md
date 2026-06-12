# ABUZ8 OS ↔ Claude Desktop — Two-Way Bridge

This documents exactly what the "two-way symbiosis" is, what's real, and its honest limits.

## The two directions

### Inbound: Claude Desktop → ABUZ8 (the symbiote)
A stdio MCP server (`mcp/abuz8-mcp-stdio.js`) is registered in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "abuz8_os": {
      "command": "C:\\Users\\<you>\\AppData\\Roaming\\abuz8-os\\mcp\\abuz8-claude-bridge\\node.exe",
      "args": ["C:\\Users\\<you>\\AppData\\Roaming\\abuz8-os\\mcp\\abuz8-claude-bridge\\abuz8-mcp-stdio.js"],
      "env": { "ABUZ8_CORE_URL": "http://127.0.0.1:8900" }
    }
  }
}
```

When Claude Desktop runs, it can call these ABUZ8 tools (each proxies to a Portable Core endpoint):
`abuz8_chat`, `abuz8_device_probe`, `abuz8_brains_list`, `abuz8_brain_select`, `abuz8_memory_write`, `abuz8_tools_list`, `abuz8_tool_create`, `abuz8_tool_call`, `abuz8_mission_board`, `abuz8_mission_task_create`, `abuz8_mission_task_move`.

**Self-healing:** every ABUZ8 launch runs `reinstateBridge()` → re-writes this config block and copies a fresh `node.exe` + bridge script into `…\abuz8-claude-bridge\`. So it can't get "misplaced" — it reinstalls itself. **Restart Claude Desktop** once after install to load it.

### Outbound: ABUZ8 → Claude's tools (shared MCP fleet)
On startup ABUZ8 reads Claude Desktop's config and **imports its other MCP servers** into ABUZ8's own catalog (`mcp/mcp_servers.json`, `source: "claude-desktop"`). ABUZ8 then runs those same servers through its **own MCP client** (`/api/mcp/*`). Net effect: any MCP tool/connection Claude Desktop has, ABUZ8 can call too.

## The honest limit

Claude Desktop is **not itself an MCP server**, so nothing can remote-control its chat window or "borrow its model." The real, working symbiosis is:

1. Claude Desktop calls ABUZ8's tools (inbound symbiote), **and**
2. ABUZ8 runs the same MCP tool fleet Claude uses (outbound shared servers).

That is genuine bidirectional tool interoperability. It is **not** ABUZ8 puppeting Claude's conversation — that capability does not exist in any product and is not faked here.

## Status & control
- `GET /api/bridge/status` → both directions, server counts, config path.
- `POST /api/bridge/reinstall` → force reinstate now.
- UI: **Claude Bridge** view shows live status and a Reinstate button.
