# Twilio AG-UI Voice Assistant

A Twilio Conversation Relay integration that uses the AG-UI protocol to communicate with backend AI systems. This allows you to build voice assistants that can work with any AG-UI compatible backend, not just specific LLM providers.

## Architecture Overview

```
Phone Call → Twilio → ConversationRelay → WebSocket → TwilioAgent → AG-UI Protocol → Backend Agent
```

The key components:

1. **TwilioAgent** - Translates between Twilio's WebSocket protocol and AG-UI events
2. **HttpAgent** - AG-UI client for connecting to HTTP/SSE backends
3. **AG-UI Protocol** - Standardized event-based protocol for agent communication

## Features

- ✅ Real-time voice conversations via Twilio
- ✅ Streaming responses with proper token handling
- ✅ Interrupt handling (user can interrupt the assistant mid-response)
- ✅ Configurable conversation modes (stateful/stateless)
- ✅ Support for any AG-UI compatible backend
- ✅ Clean separation between voice interface and AI logic
- ✅ Runtime schema validation with AG-UI core

## Prerequisites

- Node.js 18+ 
- Twilio account with a phone number
- ngrok (for exposing local server to Twilio)
- AG-UI compatible backend server

## Setup

1. **Clone and install dependencies:**
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
   Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

4. **Update .env with your configuration:**
   ```env
   NGROK_URL=abc123.ngrok.io  # Just the domain, no https://
   AGUI_BACKEND_URL=http://localhost:3000/chat  # Your AG-UI backend
   # AGUI_API_KEY=your-api-key  # Optional authorization
   # STATEFUL=false  # Optional: send only current message instead of full history
   ```

5. **Start the server:**
   ```bash
   npm start
   ```

6. **Configure Twilio:**
   - Go to your Twilio phone number settings
   - Set the webhook URL to: `https://YOUR_NGROK_URL/twiml`
   - Set the HTTP method to: POST

7. **Test it:**
   - Call your Twilio phone number
   - Start talking after the greeting!

## Project Structure

```
├── server.js              # Main server entry point
├── TwilioAgent.js         # Protocol translation layer
├── package.json           # Dependencies
├── .env.example           # Environment variables template
└── README.md              # This file
```

## Configuration Options

### Conversation Modes

The system supports two conversation modes:

**Stateful Mode (Default):**
- Maintains full conversation history
- Sends complete message thread with each request
- Provides full context to the backend
- Higher bandwidth usage as conversation grows

**Stateless Mode:**
- Sends only the current user message
- Minimal bandwidth usage
- Backend must handle context externally

Set `STATEFUL=false` in your `.env` file to enable stateless mode.

### AG-UI Backend Requirements

Your backend must accept `RunAgentInput` requests and return AG-UI events via Server-Sent Events (SSE). The system uses the `@ag-ui/client` package's `HttpAgent` to communicate with your backend.

## How It Works

### 1. Twilio WebSocket Protocol

Twilio sends three types of messages:
- `setup` - Initialize the session with a call ID
- `prompt` - User's spoken text
- `interrupt` - User interrupted the assistant

Twilio expects responses in this format:
```javascript
{
  type: "text",
  token: "Hello ",  // Incremental text
  last: false       // true when message is complete
}
```

### 2. AG-UI Event Protocol

The AG-UI protocol uses events like:
- `TEXT_MESSAGE_START` - Beginning of assistant response
- `TEXT_MESSAGE_CONTENT` - Incremental content (delta)
- `TEXT_MESSAGE_END` - End of response
- `TOOL_CALL_*` - Tool/function calling events
- `STATE_*` - State management events

### 3. Protocol Translation

The `TwilioAgent` handles the translation:
```javascript
// AG-UI Event → Twilio Token
TEXT_MESSAGE_CONTENT: { delta: "Hello " } → { type: "text", token: "Hello ", last: false }
TEXT_MESSAGE_END: {} → { type: "text", token: "", last: true }
```

## Advanced Features

### Tool Calling

The system supports AG-UI tool calling events. You could announce tool usage to the user:

```javascript
case "TOOL_CALL_START":
  ws.send(JSON.stringify({
    type: "text",
    token: `Let me check that for you... `,
    last: false
  }));
  break;
```

### State Management

The AG-UI protocol supports state snapshots and deltas, allowing you to maintain conversation context across calls or implement more complex conversation flows.

### Custom Events

You can handle custom AG-UI events to implement domain-specific features.

## Development

### Running in Development Mode

```bash
npm run dev  # Uses node --watch for auto-reload
```

### Debug Logging

Set `LOG_LEVEL=debug` in your `.env` file for detailed logging.

### Environment Variables

Key configuration options in `.env`:

- `NGROK_URL` - Your ngrok domain (without https://)
- `AGUI_BACKEND_URL` - Your AG-UI backend endpoint
- `AGUI_API_KEY` - Optional authorization token
- `STATEFUL` - Conversation mode (true/false)
- `LOG_LEVEL` - Logging verbosity (info/debug)

## Troubleshooting

### "Session error" message
- Check that ngrok is running and the URL is correct in `.env`
- Ensure the server is running

### No response from assistant
- Check your AG-UI backend is running and accessible
- Verify AGUI_BACKEND_URL is correct
- Look at server logs for errors
- Test your backend endpoint directly

### Interruptions not working properly
- This is normal if the assistant is speaking very quickly
- The system tracks what was actually spoken via `utteranceUntilInterrupt`

## License

MIT

## Contributing

Contributions welcome! This is a reference implementation showing how to integrate Twilio with the AG-UI protocol. Feel free to:

- Add support for more AG-UI events
- Implement additional backends
- Improve error handling
- Add tests

## Architecture Notes

- Built on **Fastify 5.x** with WebSocket support
- Uses **@ag-ui/client** for backend communication
- Runtime schema validation with **@ag-ui/core**
- Each phone call gets isolated agent instance
- Proper interrupt handling with abort controller management
- Real-time streaming responses with conversation tracking
