import Fastify from "fastify";
import fastifyFormBody from "@fastify/formbody";
import { TwilioAgent } from "./TwilioAgent.js";
import { HttpAgent } from "@ag-ui/client";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.NGROK_URL || `localhost:${PORT}`;
const WS_URL = process.env.NGROK_URL ? `wss://${DOMAIN}/ws` : `ws://${DOMAIN}/ws`;
const WELCOME_GREETING = process.env.WELCOME_GREETING || 
  "Hi! I am an A I voice assistant powered by Twilio and AG-UI. Ask me anything!";


// Create the AG-UI HTTP backend agent
const backendAgent = new HttpAgent({
  url: process.env.AGUI_BACKEND_URL || "http://localhost:8000/chat",
  headers: process.env.AGUI_API_KEY ? {
    Authorization: `Bearer ${process.env.AGUI_API_KEY}`
  } : {}
});

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
  console.log(`
🚀 Server running:
   - HTTP: http://localhost:${PORT}
   - WebSocket: ${WS_URL}
   - TwiML endpoint: http://localhost:${PORT}/twiml
   
📞 To test with Twilio:
   1. Make sure ngrok is running: ngrok http ${PORT}
   2. Update NGROK_URL in .env with your ngrok URL
   3. Configure your Twilio phone number webhook to: https://YOUR_NGROK_URL/twiml
  `);
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
