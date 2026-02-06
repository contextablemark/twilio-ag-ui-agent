# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Twilio Conversation Relay integration that uses the AG-UI protocol (v0.0.43) to build voice assistants. It translates between Twilio's WebSocket protocol and AG-UI events, enabling any AG-UI-compatible backend to power voice conversations.

**Architecture:** `Phone Call → Twilio → ConversationRelay → WebSocket → TwilioAgent → AG-UI Protocol → Backend Agent`

## Development Commands

```bash
# Start server (production)
npm start

# Start with auto-reload (development)
npm run dev

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Core Architecture

### Key Components

**server.js** - Main entry point
- Creates Fastify server with WebSocket support
- Configures the HttpAgent (AG-UI backend client) with Bearer token auth
- Validates required environment variables on startup
- Supports Railway (RAILWAY_PUBLIC_DOMAIN), ngrok (NGROK_URL), and local development
- Exposes `/twiml` endpoint for Twilio webhook
- Exposes `/ws` endpoint for WebSocket connections
- Exposes `/health` endpoint for health checks
- Handles graceful shutdown

**TwilioAgent.js** - Protocol translation layer (main logic)
- Uses `EventType` enum from `@ag-ui/core` for all event type matching
- Maintains isolated agent instances per call (keyed by callSid)
- Translates Twilio WebSocket messages to AG-UI events
- Handles three Twilio message types:
  - `setup`: Initializes call session with callSid
  - `prompt`: User's spoken text
  - `interrupt`: User interrupted the assistant mid-response
- Manages conversation state in two modes:
  - **Stateful** (default): Maintains full conversation history in `agent.messages[]`
  - **Stateless**: Sends only current message to backend
- Tracks partial message content during streaming via `agent._currentContent`
- Handles interrupt truncation using `utteranceUntilInterrupt`
- **TTS Buffering**: Prevents buffer underflows by accumulating small chunks
  - Buffers text in `agent._outputBuffer` before sending to Twilio
  - Flushes when buffer reaches `minChunkSize` (default: 50 characters)
  - Flushes on sentence boundaries (`.!?;:`) for natural breaks
  - Always flushes remaining content on `TEXT_MESSAGE_END`

### AG-UI Event Flow

Uses `EventType` enum from `@ag-ui/core` for type-safe event matching. AG-UI supports two patterns for text messages:

**Streaming Pattern (START/CONTENT/END):**
```javascript
EventType.TEXT_MESSAGE_START → Initialize tracking
EventType.TEXT_MESSAGE_CONTENT (delta) → { type: "text", token: delta, last: false }
EventType.TEXT_MESSAGE_END → { type: "text", token: "", last: true }
```

**Chunk Pattern (single event):**
```javascript
EventType.TEXT_MESSAGE_CHUNK → Transforms into START/CONTENT/END sequence
```

**Additional event types handled (AG-UI 0.0.43):**
- `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_CHUNK`, `TOOL_CALL_RESULT` - tool lifecycle
- `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR` - run lifecycle
- `STEP_STARTED`, `STEP_FINISHED` - step lifecycle
- `STATE_SNAPSHOT`, `STATE_DELTA`, `MESSAGES_SNAPSHOT` - state management

**State tracking pattern:**
- `TEXT_MESSAGE_START` sets `agent._currentMessageId`, `agent._currentContent = ""`, `agent._currentRole`, and `agent._outputBuffer = ""`
- `TEXT_MESSAGE_CONTENT` appends `event.delta` to both `_currentContent` (full message) and `_outputBuffer` (pending TTS chunks)
- Content is only sent to Twilio when:
  - Buffer size reaches `minChunkSize` threshold
  - Buffer ends with sentence boundary (`.!?;:`)
  - `TEXT_MESSAGE_END` is received (flushes remaining buffer)
- `TEXT_MESSAGE_END` adds complete message to `agent.messages[]` (stateful mode only) and cleans up temp vars
- `TEXT_MESSAGE_CHUNK` is transformed by recursively calling handleAgentEvent with START/CONTENT/END events

**TEXT_MESSAGE_CHUNK handling:**
- Self-contained event with optional `messageId`, `delta`, and `role` fields
- Automatically transformed into the three-event sequence (START → CONTENT → END)
- Generates messageId with `uuidv4()` if not provided
- Note: In AG-UI 0.0.43+, the client's `transformChunks` operator in `run()` already handles this transformation, but TwilioAgent keeps it as a defensive fallback

### Interrupt Handling

When user interrupts:
1. Set `isInterrupted = true` to stop processing new events
2. Call `agent.abortRun()` if available (abort controller pattern)
3. Unsubscribe from current run subscription
4. Truncate `agent._currentContent` and last assistant message to `utteranceUntilInterrupt`
5. Send final token with `last: true`

## Configuration

All configuration is via environment variables (no hardcoded URLs or secrets):

**Required:**
- `AGUI_BACKEND_URL` - AG-UI backend endpoint (server exits if not set)
- `AGUI_API_KEY` - Bearer token for AG-UI backend authentication

**Deployment (auto-detected):**
- `RAILWAY_PUBLIC_DOMAIN` - Set automatically by Railway
- `NGROK_URL` - Your ngrok domain for local tunnel dev (no https://)
- `PORT` - Server port (default: 8080, set automatically by Railway)

**Optional:**
- `WELCOME_GREETING` - Initial greeting message
- `STATEFUL` - `true` (default) sends full history, `false` sends only current message
- `MIN_CHUNK_SIZE` - Minimum characters to buffer before sending to TTS (default: 50)
- `LOG_LEVEL` - `info` (default) or `debug`

## Deployment

### Railway
1. Connect your GitHub repo to Railway
2. Set required environment variables in Railway dashboard:
   - `AGUI_BACKEND_URL` - Your AG-UI backend endpoint
   - `AGUI_API_KEY` - Your Bearer token
3. Railway auto-sets `PORT` and `RAILWAY_PUBLIC_DOMAIN`
4. Configure Twilio phone number webhook to: `https://YOUR_RAILWAY_DOMAIN/twiml`

### Local Development
1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill in required values
3. Start ngrok: `ngrok http 8080`
4. Set `NGROK_URL` in `.env` with ngrok domain
5. Run server: `npm run dev`
6. Configure Twilio phone number webhook to: `https://YOUR_NGROK_URL/twiml`

## Testing

Tests are in `TwilioAgent.test.js` using Vitest with:
- Mocked WebSocket connections
- Mocked AG-UI backend agents
- Event emission testing for all Twilio message types
- Coverage of all AG-UI 0.0.43 event types (run lifecycle, tool lifecycle, state events)

Run specific test file:
```bash
npx vitest TwilioAgent.test.js
```

## Key Implementation Details

### Bearer Token Authentication
The HttpAgent sends `Authorization: Bearer <AGUI_API_KEY>` header with all requests to the AG-UI backend. The `clone()` method preserves headers, so per-call agent instances inherit authentication.

### TTS Buffering Strategy
The implementation buffers small text chunks to prevent TTS engine buffer underflows:

**Buffering logic:**
1. Incoming deltas accumulate in `agent._outputBuffer`
2. Buffer is flushed and sent to Twilio when:
   - Size reaches `minChunkSize` threshold (default 50 chars)
   - Content ends with sentence boundary: `.!?;:`
   - `TEXT_MESSAGE_END` event received (final flush)
3. This prevents sending tiny chunks (e.g., individual characters) that cause TTS stuttering

**Tuning for your use case:**
- Increase `MIN_CHUNK_SIZE` for more stable TTS but higher latency
- Decrease for faster response but potential audio gaps
- Sentence boundaries provide natural breaks regardless of size

### Agent Instance Management
- Each phone call gets isolated agent instance stored in `this.agentInstances` Map
- Agent cloning pattern: `currentAgent = this.backendAgent.clone()`
- threadId set to callSid for per-call conversation context

### Message History (Stateful Mode)
Messages stored in `agent.messages[]` array with structure:
```javascript
{
  id: uuidv4(),
  role: "user" | "assistant",
  content: "message text"
}
```

### Schema Validation
Uses `@ag-ui/core` RunAgentInputSchema for validation:
```javascript
RunAgentInputSchema.parse({
  threadId,
  runId,
  messages,
  state: {},
  tools: [],
  context: [],
  forwardedProps: {}
})
```

### WebSocket Lifecycle
- Connection timeout: 5 seconds warning if no messages received
- Cleanup on close: Delete agent instance, unsubscribe from runs
- Error handling: Send user-friendly error messages to Twilio

## Dependencies

**Core:**
- `fastify` v5.x - Web server
- `@fastify/websocket` - WebSocket support
- `@ag-ui/client` v0.0.43+ - HttpAgent for backend communication
- `@ag-ui/core` v0.0.43+ - EventType enum and schema validation

**Dev:**
- `vitest` - Test runner
- `@vitest/coverage-v8` - Coverage reporting
