import fastifyWs from "@fastify/websocket";
import { v4 as uuidv4 } from "uuid";
import { RunAgentInputSchema } from "@ag-ui/core";

export class TwilioAgent {
  constructor(config) {
    this.welcomeGreeting = config.welcomeGreeting;
    this.wsPath = config.wsPath || "/ws";
    this.backendAgent = config.backendAgent;
    this.stateful = config.stateful !== false; // Default to true (stateful)
    this.agentInstances = new Map();
  }

  attachToServer(fastify) {
    fastify.register(fastifyWs);
    
    fastify.register(async (fastify) => {
      fastify.get(this.wsPath, { websocket: true }, (ws, req) => {
        fastify.log.info({ 
          path: this.wsPath, 
          headers: req.headers,
          secWebsocketVersion: req.headers['sec-websocket-version'],
          secWebsocketKey: req.headers['sec-websocket-key']
        }, "WebSocket connection established");
        
        // WebSocket connection established
        
        let callSid;
        let currentAgent;
        let currentRunSubscription;
        let isInterrupted = false;

        ws.on("open", () => {
          fastify.log.info("WebSocket opened");
        });
        
        // Test if we can send messages
        try {
          // Don't send anything initially - Twilio expects to send the first message
          fastify.log.info("WebSocket ready to receive messages");
        } catch (error) {
          fastify.log.error({ error }, "Error with WebSocket");
        }
        
        // Set a timeout to check if we receive any messages
        const connectionTimeout = setTimeout(() => {
          fastify.log.warn("No messages received from Twilio after 5 seconds");
          fastify.log.info({ 
            readyState: ws.readyState,
            bufferedAmount: ws.bufferedAmount 
          }, "WebSocket state after timeout");
        }, 5000);

        ws.on("error", (error) => {
          fastify.log.error({ error }, "WebSocket error");
        });

        ws.on("close", (code, reason) => {
          fastify.log.info({ code, reason }, "WebSocket closed");
          // Clean up agent instance if exists
          if (callSid && this.agentInstances.has(callSid)) {
            this.agentInstances.delete(callSid);
          }
          // Unsubscribe from any active run
          if (currentRunSubscription) {
            currentRunSubscription.unsubscribe();
          }
        });
        

        ws.on("message", async (data) => {
          // Clear the timeout since we received a message
          clearTimeout(connectionTimeout);
          
          let message;
          try {
            message = JSON.parse(data);
          } catch (error) {
            fastify.log.error({ error, data: data.toString() }, "Failed to parse WebSocket message");
            return;
          }
          
          fastify.log.info({ type: message.type }, "Received Twilio message");

          switch (message.type) {
            case "setup":
              callSid = message.callSid;
              fastify.log.info({ callSid }, "Setting up new call session");
              
              // Clone the backend agent for this session
              // Each call gets its own agent instance with separate state
              if (this.backendAgent.clone) {
                currentAgent = this.backendAgent.clone();
              } else {
                // Fallback if clone isn't implemented
                currentAgent = Object.create(this.backendAgent);
                currentAgent.messages = [];
              }
              
              // Set threadId to callSid to maintain conversation context per call
              currentAgent.threadId = callSid;
              
              this.agentInstances.set(callSid, currentAgent);
              break;

            case "prompt":
              fastify.log.info({ prompt: message.voicePrompt }, "Processing voice prompt");
              isInterrupted = false;
              
              if (!currentAgent) {
                fastify.log.error("No agent instance found for prompt");
                ws.send(JSON.stringify({
                  type: "text",
                  token: "I'm sorry, there was a session error. Please try again.",
                  last: true
                }));
                return;
              }
              
              // Prepare messages based on stateful/stateless mode
              const userMessage = {
                id: uuidv4(),
                role: "user",
                content: message.voicePrompt
              };
              
              let messagesToSend;
              if (this.stateful) {
                // Stateful: maintain full conversation history
                currentAgent.messages = currentAgent.messages || [];
                currentAgent.messages.push(userMessage);
                messagesToSend = currentAgent.messages;
              } else {
                // Stateless: only send current message
                messagesToSend = [userMessage];
              }
              
              try {
                // Run the agent with the updated conversation using proper schema
                const runAgentInput = RunAgentInputSchema.parse({
                  threadId: currentAgent.threadId || uuidv4(),
                  runId: uuidv4(),
                  messages: messagesToSend,
                  state: {},
                  tools: [],
                  context: [],
                  forwardedProps: {}
                });
                
                // Always create a fresh abortController for each new request
                // This ensures we don't reuse an aborted controller
                if (currentAgent.abortController) {
                  currentAgent.abortController = new AbortController();
                }
                
                // Subscribe to the agent's event stream
                currentRunSubscription = currentAgent.run(runAgentInput).subscribe({
                  next: (event) => {
                    if (!isInterrupted) {
                      this.handleAgentEvent(event, ws, currentAgent);
                    }
                  },
                  error: (err) => {
                    fastify.log.error({ err }, "Agent runtime error");
                    if (!isInterrupted) {
                      ws.send(JSON.stringify({
                        type: "text",
                        token: "I'm sorry, I encountered an error processing your request.",
                        last: true
                      }));
                    }
                  },
                  complete: () => {
                    fastify.log.info("Agent run completed");
                  }
                });
              } catch (err) {
                fastify.log.error({ err }, "Failed to run agent");
                ws.send(JSON.stringify({
                  type: "text",
                  token: "I'm sorry, I couldn't process your request.",
                  last: true
                }));
              }
              break;

            case "interrupt":
              fastify.log.info({ 
                utterance: message.utteranceUntilInterrupt 
              }, "Handling voice interruption");
              
              isInterrupted = true;
              
              // Try to abort the current run if the agent supports it
              if (currentAgent && currentAgent.abortRun) {
                try {
                  // Check if abortController exists and has abort method
                  if (currentAgent.abortController && typeof currentAgent.abortController.abort === 'function') {
                    currentAgent.abortRun();
                  } else {
                    fastify.log.warn("Agent abortController not properly initialized, skipping abortRun");
                  }
                } catch (error) {
                  fastify.log.warn({ error: error.message }, "Failed to abort agent run, continuing with subscription cancellation");
                }
              }
              
              // Cancel the subscription to stop receiving events
              if (currentRunSubscription) {
                currentRunSubscription.unsubscribe();
                currentRunSubscription = null;
              }
              
              // Update the agent's conversation history (if stateful)
              if (this.stateful) {
                this.handleInterrupt(currentAgent, message.utteranceUntilInterrupt);
              }
              
              // Send the final token to complete the interrupted message
              ws.send(JSON.stringify({
                type: "text",
                token: "",
                last: true
              }));
              break;

            default:
              fastify.log.warn({ type: message.type }, "Unknown message type");
          }
        });
      });
    });
  }

  handleAgentEvent(event, ws, agent) {
    switch (event.type) {
      case "TEXT_MESSAGE_CHUNK":
        // Handle self-contained chunk event by transforming it into START/CONTENT/END sequence
        // This is a convenience event that combines all three phases
        const chunkMessageId = event.messageId || uuidv4();
        const chunkDelta = event.delta || "";

        // Emit START
        this.handleAgentEvent({
          type: "TEXT_MESSAGE_START",
          messageId: chunkMessageId,
          role: event.role || "assistant"
        }, ws, agent);

        // Emit CONTENT (if there's content)
        if (chunkDelta) {
          this.handleAgentEvent({
            type: "TEXT_MESSAGE_CONTENT",
            messageId: chunkMessageId,
            delta: chunkDelta
          }, ws, agent);
        }

        // Emit END
        this.handleAgentEvent({
          type: "TEXT_MESSAGE_END",
          messageId: chunkMessageId
        }, ws, agent);
        break;

      case "TEXT_MESSAGE_START":
        // Initialize tracking for the new message
        agent._currentMessageId = event.messageId;
        agent._currentContent = "";
        agent._currentRole = event.role || "assistant";
        break;

      case "TEXT_MESSAGE_CONTENT":
        // Stream content tokens to Twilio
        agent._currentContent = (agent._currentContent || "") + event.delta;

        ws.send(JSON.stringify({
          type: "text",
          token: event.delta,
          last: false
        }));
        break;

      case "TEXT_MESSAGE_END":
        // Signal end of message to Twilio
        ws.send(JSON.stringify({
          type: "text",
          token: "",
          last: true
        }));

        // Update agent's message history with the complete response (if stateful)
        // Check for undefined/null instead of truthiness to allow empty strings
        if (this.stateful && agent._currentMessageId && agent._currentContent !== undefined) {
          const assistantMessage = {
            id: agent._currentMessageId,
            role: agent._currentRole || "assistant",
            content: agent._currentContent
          };

          agent.messages = agent.messages || [];
          agent.messages.push(assistantMessage);
        }

        // Clean up temporary tracking
        if (agent._currentMessageId !== undefined) {
          delete agent._currentMessageId;
        }
        if (agent._currentContent !== undefined) {
          delete agent._currentContent;
        }
        if (agent._currentRole !== undefined) {
          delete agent._currentRole;
        }
        break;

      // Tool-related events could be announced to the user
      case "TOOL_CALL_START":
        // Optionally announce tool usage to the user
        // ws.send(JSON.stringify({
        //   type: "text",
        //   token: `Let me check that for you using ${event.toolCallName}... `,
        //   last: false
        // }));
        break;

      case "TOOL_CALL_END":
        break;

      // State updates (not implemented - backend handles state)
      case "STATE_SNAPSHOT":
      case "STATE_DELTA":
        // State management is handled by the backend
        break;

      // Other events don't need Twilio-specific handling
      default:
        break;
    }
  }

  handleInterrupt(agent, utteranceUntilInterrupt) {
    if (!agent || !agent.messages) return;
    
    // Find the last assistant message
    const messages = agent.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === "assistant" && message.content) {
        // Check if this message contains the interrupted utterance
        const interruptIndex = message.content.indexOf(utteranceUntilInterrupt);
        if (interruptIndex !== -1) {
          // Truncate the message to only include what was actually spoken
          message.content = message.content.substring(
            0,
            interruptIndex + utteranceUntilInterrupt.length
          );
          break;
        }
      }
    }
    
    // Also truncate any in-progress content
    if (agent._currentContent && utteranceUntilInterrupt) {
      const interruptIndex = agent._currentContent.indexOf(utteranceUntilInterrupt);
      if (interruptIndex !== -1) {
        agent._currentContent = agent._currentContent.substring(
          0,
          interruptIndex + utteranceUntilInterrupt.length
        );
      }
    }
  }
}
