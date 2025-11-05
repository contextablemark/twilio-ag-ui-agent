# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Twilio Conversation Relay integration that uses the AG-UI protocol to build voice assistants. It translates between Twilio's WebSocket protocol and AG-UI events, enabling any AG-UI-compatible backend to power voice conversations.

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
- Configures the HttpAgent (AG-UI backend client)
- Sets up TwilioAgent with backend agent
- Exposes `/twiml` endpoint for Twilio webhook
- Exposes `/ws` endpoint for WebSocket connections
- Handles graceful shutdown

**TwilioAgent.js** - Protocol translation layer (main logic)
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

AG-UI supports two patterns for text messages:

**Streaming Pattern (START/CONTENT/END):**
```javascript
TEXT_MESSAGE_START → Initialize tracking
TEXT_MESSAGE_CONTENT (delta) → { type: "text", token: delta, last: false }
TEXT_MESSAGE_END → { type: "text", token: "", last: true }
```

**Chunk Pattern (single event):**
```javascript
TEXT_MESSAGE_CHUNK → Transforms into START/CONTENT/END sequence
```

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
- Useful for backends that send complete messages at once rather than streaming

### Interrupt Handling

When user interrupts:
1. Set `isInterrupted = true` to stop processing new events
2. Call `agent.abortRun()` if available (abort controller pattern)
3. Unsubscribe from current run subscription
4. Truncate `agent._currentContent` and last assistant message to `utteranceUntilInterrupt`
5. Send final token with `last: true`

## Configuration

Environment variables in `.env`:

- `NGROK_URL` - Your ngrok domain (no https://)
- `PORT` - Server port (default: 8080)
- `WELCOME_GREETING` - Initial greeting message
- `AGUI_BACKEND_URL` - AG-UI backend endpoint
- `AGUI_API_KEY` - Optional authorization token
- `STATEFUL` - `true` (default) sends full history, `false` sends only current message
- `MIN_CHUNK_SIZE` - Minimum characters to buffer before sending to TTS (default: 50)
- `LOG_LEVEL` - `info` (default) or `debug`

## Testing

Tests are in `TwilioAgent.test.js` using Vitest with:
- Mocked WebSocket connections
- Mocked AG-UI backend agents
- Event emission testing for all Twilio message types

Run specific test file:
```bash
npx vitest TwilioAgent.test.js
```

## Key Implementation Details

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

## Development Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env`
3. Start ngrok: `ngrok http 8080`
4. Update `NGROK_URL` in `.env` with ngrok domain
5. Set `AGUI_BACKEND_URL` to your AG-UI backend
6. Run server: `npm run dev`
7. Configure Twilio phone number webhook to: `https://YOUR_NGROK_URL/twiml`

## Dependencies

**Core:**
- `fastify` v5.x - Web server
- `@fastify/websocket` - WebSocket support
- `@ag-ui/client` - HttpAgent for backend communication
- `@ag-ui/core` - Schema validation

**Dev:**
- `vitest` - Test runner
- `@vitest/coverage-v8` - Coverage reporting
