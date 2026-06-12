# ABUZ8 OS — HTTP API reference

All endpoints are served by Portable Core on `http://127.0.0.1:8900`. JSON in/out. CORS open for the local renderer. Override the port with `ABUZ8_PORT`.

## Core / status
| Method | Path | Body / params | Returns |
|---|---|---|---|
| GET | `/health` | — | `{ok, service, port, data_root}` |
| GET | `/api/status` | — | primary brain, memory count, data root, mcp config |
| GET | `/api/system/scan` | — | listening ports (+process/PID/service), installed CLIs, hardware, endpoint catalog |
| GET | `/api/device/probe` | — | CPU/RAM/GPU/storage + capability tiers |

## Chat & reasoning
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/chat` | `{content, role?, provider?, agentic?}` | Reply ladder: provider→brain→provider→core. `role` = an agent role id. |
| POST | `/api/chat/stream` | same | SSE chunks of the final reply |
| POST | `/api/swarm/run` | `{task, roles?[]}` | Multi-agent fan-out + synthesis |

## Agents
| GET | `/api/agents/roles` | — | 11 roles `{id, name, tagline, tools}` |

## Brains & models
| GET | `/api/brains/list` | — | offline GGUF brains + status |
| POST | `/api/brains/select` | `{brain}` | `auto`/`lite`/`standard`/`pro`/id |
| GET | `/api/models/list` | — | downloaded GGUFs + embedded |
| POST | `/api/models/huggingface/download` | `{repo, file, allow_network_download:true}` | adds to local shelf |
| GET / POST | `/api/providers` | GET list; POST `{name,type,endpoint,model,api_key,enabled}` | model providers |
| POST | `/api/provider/chat` | `{provider, content}` | direct provider call |

## Tools (native control)
| GET | `/api/tools/list` | — | built-in + custom tools |
| POST | `/api/tools/call` | `{tool, args}` | execute a tool |
| POST | `/api/tools/create` | `{name, description, command?, args?}` | register a custom tool |
| POST | `/api/cmd/run` | `{command, cwd?, timeout?}` | full shell command (consent-gated) |
| GET / POST | `/api/actions/status` · `/api/actions/consent` | `{allow_actions}` | session action consent |

**Action tools** (via `/api/tools/call`): `open_url`, `open_app`, `screenshot`, `file_write`, `shell_run`, `cmd_run`, `web_search`, `draw_monkey_in_paint`. Non-action tools: `abuz8_chat`, `abuz8_device_probe`, `abuz8_memory_write`, `memory_search`, `abuz8_mission_*`, `swarm_run`, `content_generate`, `x_post`.

## MCP (Model Context Protocol)
| GET | `/api/mcp/servers` | — | configured servers + running state |
| GET | `/api/mcp/servers/:name/tools` | — | start (if needed) + list tools |
| POST | `/api/mcp/call` | `{server, tool, args}` | call an MCP tool |
| POST | `/api/mcp/servers/:name/enable` | `{enabled}` | toggle |
| POST | `/api/mcp/import/claude-desktop` | — | import Claude's MCP servers |
| POST | `/api/mcp/install/claude-symbiote` | — | install ABUZ8 into Claude Desktop |

## Two-way Claude bridge
| GET | `/api/bridge/status` | — | inbound symbiote + outbound imported servers |
| POST | `/api/bridge/reinstall` | — | reinstate symbiote + import Claude's servers |

## Growth & content
| POST | `/api/content/generate` | `{topic, format, sources?}` | format ∈ x-carousel, x-thread, youtube-script, blog-outline, notebook-synthesis |
| GET | `/api/content/formats` | — | format list |
| POST | `/api/x/post` | `{text, access_token?}` | X API v2 (needs OAuth2 `tweet.write`) |
| POST | `/api/growth/seed` | — | seed 25-problems board + 7-day cadence |

## Kanban / mission
| GET | `/api/mission/board` | — | columns + tasks + summary |
| POST | `/api/mission/task` | `{title, column?, priority?, owner?, details?}` | upsert |
| POST | `/api/mission/move` | `{id, column}` | move task |

## Memory
| GET | `/api/memory/recent` | `?limit=` | recent items |
| POST | `/api/memory/write` | `{content, type?}` | append |
| GET | `/api/memory/search` | `?q=` | search |

## Skills
| GET | `/api/skills/installed` | — | migrated skill packs |

## Voice (Windows)
| POST | `/api/tts` · `/api/stt` | TTS `{text, voice?}` → WAV; STT `{audio_base64}` → text | native System.Speech |
| GET | `/api/voice/status` | — | available voices/recognizers |
