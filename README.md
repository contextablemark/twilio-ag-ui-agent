# Twilio AG-UI Voice Assistant

A Twilio Conversation Relay integration that uses the [AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui) (v0.0.43) to communicate with backend AI systems. Build voice assistants that work with any AG-UI-compatible backend.

## Architecture

```
Phone Call → Twilio → ConversationRelay → WebSocket → TwilioAgent → AG-UI Protocol → Backend Agent
```

| Component | Role |
|-----------|------|
| **TwilioAgent** | Translates between Twilio's WebSocket protocol and AG-UI events |
| **HttpAgent** | AG-UI client for connecting to HTTP/SSE backends with Bearer token auth |
| **AG-UI Protocol** | Standardized event-based protocol for agent communication (v0.0.43) |

## Features

- Real-time voice conversations via Twilio
- Streaming responses with TTS-optimized buffering
- Interrupt handling (user can interrupt mid-response)
- Bearer token authentication for AG-UI backend
- Configurable conversation modes (stateful/stateless)
- Works with any AG-UI 0.0.43-compatible backend
- Deployable to Railway or any Node.js hosting platform
- Full AG-UI 0.0.43 event coverage (text, tool, run lifecycle, state)

## Prerequisites

- Node.js 20+
- Twilio account with a phone number
- AG-UI compatible backend server
- For local dev: ngrok (for exposing local server to Twilio)

## Quick Start

### Deploy to Railway

1. Connect your GitHub repo to Railway
2. Set required environment variables in the Railway dashboard:
   - `AGUI_BACKEND_URL` - Your AG-UI backend endpoint
   - `AGUI_BEARER_TOKEN` - Bearer token for backend authentication
3. Railway auto-sets `PORT` and `RAILWAY_PUBLIC_DOMAIN`
4. Configure your Twilio phone number webhook to: `https://YOUR_RAILWAY_DOMAIN/twiml`
5. Call your Twilio phone number

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Start ngrok:**
   ```bash
   ngrok http 8080
   ```

4. **Update .env:**
   ```env
   NGROK_URL=abc123.ngrok.io
   AGUI_BACKEND_URL=https://your-backend.example.com/chat
   AGUI_BEARER_TOKEN=your-api-key
   ```

5. **Start the server:**
   ```bash
   npm run dev
   ```

6. **Configure Twilio:**
   - Set your phone number webhook to: `https://YOUR_NGROK_URL/twiml`
   - HTTP method: POST

7. **Call your Twilio phone number and start talking!**

## Configuration

All configuration is via environment variables (no hardcoded URLs or secrets).

### Required

| Variable | Description |
|----------|-------------|
| `AGUI_BACKEND_URL` | AG-UI backend endpoint (server exits if not set) |
| `AGUI_BEARER_TOKEN` | Bearer token for AG-UI backend authentication |

### Deployment

| Variable | Description |
|----------|-------------|
| `RAILWAY_PUBLIC_DOMAIN` | Set automatically by Railway |
| `NGROK_URL` | ngrok domain for local tunnel dev (no `https://`) |
| `PORT` | Server port (default: 8080, auto-set by Railway) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `WELCOME_GREETING` | `"Hi! I am an AI voice assistant..."` | Initial greeting message |
| `STATEFUL` | `true` | `true` sends full history, `false` sends only current message |
| `MIN_CHUNK_SIZE` | `50` | Minimum characters to buffer before sending to TTS |
| `LOG_LEVEL` | `info` | Logging level (`info` or `debug`) |

## Project Structure

```
├── server.js              # Main server (HTTP, WebSocket, config validation)
├── TwilioAgent.js         # Protocol translation layer
├── TwilioAgent.test.js    # Test suite (24 tests)
├── vitest.config.js       # Test configuration
├── package.json           # Dependencies (AG-UI 0.0.43+)
├── .env.example           # Environment variables template
├── CLAUDE.md              # Claude Code guidance
└── README.md              # This file
```

## How It Works

### Twilio WebSocket Protocol

Twilio sends three message types over WebSocket:
- `setup` - Initialize the session with a call ID
- `prompt` - User's spoken text (speech-to-text result)
- `interrupt` - User interrupted the assistant mid-response

Twilio expects responses as:
```json
{ "type": "text", "token": "Hello ", "last": false }
{ "type": "text", "token": "",       "last": true  }
```

### AG-UI Event Protocol (v0.0.43)

The TwilioAgent handles all AG-UI 0.0.43 event types using the `EventType` enum:

**Text message events:**
- `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` - Streaming pattern
- `TEXT_MESSAGE_CHUNK` - Self-contained message (auto-transformed to streaming pattern)

**Tool events:**
- `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_CHUNK` / `TOOL_CALL_RESULT`

**Run lifecycle events:**
- `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR` / `STEP_STARTED` / `STEP_FINISHED`

**State events:**
- `STATE_SNAPSHOT` / `STATE_DELTA` / `MESSAGES_SNAPSHOT`

### TTS Buffering

Small text chunks are buffered to prevent TTS engine stuttering:
1. Deltas accumulate in an output buffer
2. Buffer flushes when it reaches `MIN_CHUNK_SIZE` (default 50 chars) or hits a sentence boundary (`.!?;:`)
3. Remaining buffer always flushes on message end

### Bearer Token Authentication

The `AGUI_BEARER_TOKEN` is sent as `Authorization: Bearer <token>` with all requests. The `HttpAgent.clone()` method preserves headers, so per-call agent instances inherit authentication automatically.

## Conversation Modes

**Stateful (default):** Maintains full conversation history. Sends complete message thread with each request. Provides full context to the backend.

**Stateless:** Sends only the current user message. Backend must handle context externally (e.g., via threadId). Set `STATEFUL=false` to enable.

## AG-UI Backend Requirements

Your backend must:
1. Accept `RunAgentInput` requests (validated against `RunAgentInputSchema`)
2. Return AG-UI events via Server-Sent Events (SSE)
3. Accept `Authorization: Bearer <token>` header
4. Be compatible with AG-UI protocol v0.0.43

## Testing

```bash
npm test              # Run all 24 tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/twiml` | GET/POST | Returns TwiML XML for Twilio webhook |
| `/ws` | WebSocket | Twilio ConversationRelay WebSocket connection |
| `/health` | GET | Health check (`{ status: "ok", timestamp: "..." }`) |

## Troubleshooting

**"AGUI_BACKEND_URL environment variable is required"**
- Set `AGUI_BACKEND_URL` in your environment variables (Railway dashboard or `.env` file)

**"Session error" message on call**
- Check that your public domain is correctly configured (Railway or ngrok)
- Ensure the server is running and accessible

**No response from assistant**
- Verify `AGUI_BACKEND_URL` points to a running AG-UI backend
- Check `AGUI_BEARER_TOKEN` is correct
- Look at server logs (`LOG_LEVEL=debug` for details)

**Interruptions not working**
- Normal if the assistant is speaking very quickly
- The system tracks what was actually spoken via `utteranceUntilInterrupt`

## License

MIT
