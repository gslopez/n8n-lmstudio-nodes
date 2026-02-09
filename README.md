# n8n-nodes-lmstudio

An [n8n](https://n8n.io) community node for [LM Studio](https://lmstudio.ai) — run local LLMs with optional JSON schema for structured outputs.

## Features

- **Dynamic model selector** — fetches available models from your LM Studio server, shows loaded/unloaded state and quantization info
- **Structured JSON output** — provide a JSON schema and get validated, parsed responses
- **Usable as a tool** — can be used as a tool node in n8n AI agent workflows

## Installation

### In n8n (recommended)

1. Go to **Settings > Community Nodes**
2. Select **Install a community node**
3. Enter `n8n-nodes-lmstudio`
4. Agree to the risks and click **Install**

### Manual

```bash
npm install n8n-nodes-lmstudio
```

## Configuration

### Credential: LM Studio API

| Field    | Description                                    | Default                |
|----------|------------------------------------------------|------------------------|
| Host URL | LM Studio server URL with protocol and port    | `http://localhost:1234` |
| API Key  | Optional API key (leave empty if not required)  |                        |

The credential tests connectivity by hitting your server's `/api/v0/models` endpoint.

### Node: LM Studio Simple Message

| Parameter       | Description                                              |
|-----------------|----------------------------------------------------------|
| Model           | Select from available LLM/VLM models on your server      |
| Message         | The user message to send                                 |
| JSON Schema     | Optional JSON schema for structured output               |
| Temperature     | Controls randomness (0–2, default 0.3)                   |
| Max Tokens      | Maximum tokens to generate (empty = model default)       |
| Timeout         | Request timeout in seconds (0 = no timeout)              |

## Development

```bash
npm install
npm run build
npm run dev          # start n8n with hot reload
npm run lint         # check for errors
npm test             # run unit tests
npm run test:integration  # run integration tests (requires LM Studio)
```

Integration tests require a running LM Studio server:

```bash
LM_STUDIO_URL=http://localhost:1234 npm run test:integration
```

## Acknowledgments

This project was developed with assistance from [Claude](https://claude.ai), Anthropic's AI assistant.

## License

[MIT](LICENSE.md)
