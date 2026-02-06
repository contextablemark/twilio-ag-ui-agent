import Fastify from "fastify";
import fastifyFormBody from "@fastify/formbody";
import { TwilioAgent } from "./TwilioAgent.js";
import { HttpAgent } from "@ag-ui/client";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 8080;

// Public domain of THIS server (so Twilio can reach us via WebSocket).
// Railway sets RAILWAY_PUBLIC_DOMAIN automatically; NGROK_URL is for local tunnel dev only.
const DOMAIN = process.env.NGROK_URL || process.env.RAILWAY_PUBLIC_DOMAIN || `localhost:${PORT}`;
const isPublicDomain = !!(process.env.NGROK_URL || process.env.RAILWAY_PUBLIC_DOMAIN);
const WS_URL = isPublicDomain ? `wss://${DOMAIN}/ws` : `ws://${DOMAIN}/ws`;

const WELCOME_GREETING = process.env.WELCOME_GREETING ||
  "Hi! I am an A I voice assistant powered by Twilio and AG-UI. Ask me anything!";

// Validate required configuration
if (!process.env.AGUI_BACKEND_URL) {
  console.error("ERROR: AGUI_BACKEND_URL environment variable is required.");
  console.error("Set it to your AG-UI backend endpoint (e.g. https://your-backend.example.com/chat)");
  process.exit(1);
}

// Create the AG-UI HTTP backend agent with Bearer token authentication
const backendAgentConfig = {
  url: process.env.AGUI_BACKEND_URL,
};

if (process.env.AGUI_BEARER_TOKEN) {
  backendAgentConfig.headers = {
    Authorization: `Bearer ${process.env.AGUI_BEARER_TOKEN}`
  };
}

const backendAgent = new HttpAgent(backendAgentConfig);

// Create the Twilio agent that wraps the backend
const twilioAgent = new TwilioAgent({
  welcomeGreeting: WELCOME_GREETING,
  wsPath: "/ws",
  backendAgent: backendAgent,
  stateful: process.env.STATEFUL !== "false", // Default to true, set STATEFUL=false to disable
  minChunkSize: parseInt(process.env.MIN_CHUNK_SIZE || "50", 10) // Minimum characters for TTS buffering
});

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    }
  }
});

// Register form body parser for TwiML endpoint
fastify.register(fastifyFormBody);

// TwiML endpoint - returns XML for Twilio to establish WebSocket connection
fastify.all("/twiml", async (request, reply) => {
  fastify.log.info({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body,
    wsUrl: WS_URL,
    domain: DOMAIN
  }, "TwiML endpoint called");

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME_GREETING}" />
  </Connect>
</Response>`;

  fastify.log.info({ twiml, wsUrl: WS_URL }, "Sending TwiML response");

  reply
    .type("text/xml")
    .send(twiml);
});

// Health check endpoint
fastify.get("/health", async (request, reply) => {
  reply.send({ status: "ok", timestamp: new Date().toISOString() });
});

// Let TwilioAgent handle the WebSocket connections
twilioAgent.attachToServer(fastify);

// Start the server
try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on port ${PORT}`);
  console.log(`  WebSocket: ${WS_URL}`);
  console.log(`  TwiML endpoint: ${isPublicDomain ? `https://${DOMAIN}` : `http://localhost:${PORT}`}/twiml`);
  console.log(`  Health check: ${isPublicDomain ? `https://${DOMAIN}` : `http://localhost:${PORT}`}/health`);
  console.log(`  AG-UI backend: ${process.env.AGUI_BACKEND_URL}`);
  console.log(`  Bearer auth: ${process.env.AGUI_BEARER_TOKEN ? 'enabled' : 'disabled'}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await fastify.close();
  process.exit(0);
});
