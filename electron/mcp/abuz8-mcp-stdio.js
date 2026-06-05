#!/usr/bin/env node
// ABUZ8 OS MCP symbiote for Claude Desktop.
// Stdio MCP bridge that calls the local ABUZ8 Portable Core when the app is running.

const http = require('http');
const readline = require('readline');

const CORE_URL = process.env.ABUZ8_CORE_URL || 'http://127.0.0.1:8900';
const core = new URL(CORE_URL);

function coreJson(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: core.hostname,
      port: core.port || 80,
      path: pathname,
      method,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(out || '{}')); } catch { resolve({ ok: true, text: out }); }
      });
    });
    req.setTimeout(120000, () => req.destroy(new Error('ABUZ8 Portable Core timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function send(id, result, error) {
  const payload = error
    ? { jsonrpc: '2.0', id, error: { code: -32000, message: error.message || String(error) } }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function textContent(text) {
  return { content: [{ type: 'text', text: String(text || '') }] };
}

const tools = [
  {
    name: 'abuz8_chat',
    description: 'Ask the embedded ABUZ8 OS offline brain or Portable Core to reason about a task.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'User request for ABUZ8 OS.' } },
      required: ['message']
    }
  },
  {
    name: 'abuz8_device_probe',
    description: 'Probe the current machine and explain what ABUZ8 OS can do on it.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'abuz8_brains_list',
    description: 'List embedded and downloaded local ABUZ8 brain models.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'abuz8_brain_select',
    description: 'Switch the active embedded ABUZ8 brain tier for future local chat calls.',
    inputSchema: {
      type: 'object',
      properties: { brain: { type: 'string', description: 'auto, lite, standard, pro, or a bundled brain id.' } },
      required: ['brain']
    }
  },
  {
    name: 'abuz8_memory_write',
    description: 'Write a note into ABUZ8 local memory.',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string', description: 'Memory note to store locally.' } },
      required: ['content']
    }
  },
  {
    name: 'abuz8_tools_list',
    description: 'List ABUZ8 local tools, MCP tools, model shelf, and permission-gated bridges.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'abuz8_tool_create',
    description: 'Create or update a local ABUZ8 tool definition. This registers metadata only; command execution remains permission-gated.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Stable tool name.' },
        description: { type: 'string', description: 'What the tool does.' },
        type: { type: 'string', description: 'manual, cli, api, mcp, or workflow.' },
        command: { type: 'string', description: 'Optional local CLI command.' },
        endpoint: { type: 'string', description: 'Optional API endpoint.' }
      },
      required: ['name']
    }
  },
  {
    name: 'abuz8_tool_call',
    description: 'Execute a local ABUZ8 built-in or registered tool by name. Permission-gated actions require explicit flags in args.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Tool name, for example abuz8_device_probe, abuz8_mission_board, cli_probe, or a registered custom tool.' },
        args: { type: 'object', description: 'Tool arguments. Use allow_cli:true only when intentionally running a local CLI.' }
      },
      required: ['tool']
    }
  },
  {
    name: 'abuz8_mission_board',
    description: 'Read the ABUZ8 mission dashboard and Kanban board.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'abuz8_mission_task_create',
    description: 'Create or update a task on the ABUZ8 mission Kanban board.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title.' },
        column: { type: 'string', description: 'backlog, ready, doing, verify, or done.' },
        priority: { type: 'string', description: 'low, medium, high, or blocker.' },
        owner: { type: 'string', description: 'Task owner.' },
        details: { type: 'string', description: 'Short task details.' }
      },
      required: ['title']
    }
  },
  {
    name: 'abuz8_mission_task_move',
    description: 'Move an ABUZ8 mission task to another Kanban column.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id.' },
        column: { type: 'string', description: 'backlog, ready, doing, verify, or done.' }
      },
      required: ['id', 'column']
    }
  }
];

async function handle(msg) {
  if (msg.method === 'initialize') {
    return send(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'abuz8-os', version: '1.0.0' }
    });
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') return send(msg.id, { tools });
  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    try {
      if (name === 'abuz8_chat') {
        const out = await coreJson('POST', '/api/chat', { content: args.message || args.content || '' });
        return send(msg.id, textContent(`${out.response || ''}\n\n[brain: ${out.brain || 'ABUZ8'} · fallback: ${Boolean(out.fallback)}]`));
      }
      if (name === 'abuz8_device_probe') {
        const out = await coreJson('GET', '/api/device/probe');
        return send(msg.id, textContent(JSON.stringify(out, null, 2)));
      }
      if (name === 'abuz8_brains_list') {
        const out = await coreJson('GET', '/api/brains/list');
        return send(msg.id, textContent(JSON.stringify(out, null, 2)));
      }
      if (name === 'abuz8_brain_select') {
        const out = await coreJson('POST', '/api/brains/select', args);
        return send(msg.id, textContent(JSON.stringify(out, null, 2)));
      }
      if (name === 'abuz8_memory_write') {
        const out = await coreJson('POST', '/api/memory/write', { content: args.content || '' });
        return send(msg.id, textContent(JSON.stringify(out, null, 2)));
      }
      if (name === 'abuz8_tools_list') {
        const out = await coreJson('GET', '/api/tools/list');
        return send(msg.id, textContent(JSON.stringify(out, null, 2)));
      }
      if (name === 'abuz8_tool_create') {
        const out = await coreJson('POST', '/api/tools/create', args);
        return send(msg.id, textContent(JSON.stringify(out, null, 2)));
      }
      if (name === 'abuz8_tool_call') {
        const out = await coreJson('POST', '/api/tools/call', args);
        return send(msg.id, textContent(JSON.stringify(out, null, 2)));
      }
      if (name === 'abuz8_mission_board') {
        const out = await coreJson('GET', '/api/mission/board');
        return send(msg.id, textContent(JSON.stringify(out, null, 2)));
      }
      if (name === 'abuz8_mission_task_create') {
        const out = await coreJson('POST', '/api/mission/task', args);
        return send(msg.id, textContent(JSON.stringify(out, null, 2)));
      }
      if (name === 'abuz8_mission_task_move') {
        const out = await coreJson('POST', '/api/mission/move', args);
        return send(msg.id, textContent(JSON.stringify(out, null, 2)));
      }
      return send(msg.id, null, new Error(`Unknown ABUZ8 MCP tool: ${name}`));
    } catch (e) {
      return send(msg.id, textContent(`ABUZ8 OS is not reachable at ${CORE_URL}. Open ABUZ8 OS, then retry from Claude Desktop.\n\n${e.message}`));
    }
  }
  send(msg.id, null, new Error(`Unsupported MCP method: ${msg.method}`));
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    handle(msg).catch((e) => send(msg.id, null, e));
  } catch (e) {
    send(null, null, e);
  }
});
