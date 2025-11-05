import { describe, it, beforeEach, expect, vi } from 'vitest';
import { TwilioAgent } from './TwilioAgent.js';
import { EventEmitter } from 'events';

// Mock the fastify-websocket module
vi.mock('@fastify/websocket', () => ({
  default: vi.fn()
}));

// Mock the AG-UI core schema
vi.mock('@ag-ui/core', () => ({
  RunAgentInputSchema: {
    parse: vi.fn((input) => input)
  }
}));

describe('TwilioAgent', () => {
  let twilioAgent;
  let mockBackendAgent;
  let mockFastify;
  let mockWs;
  
  beforeEach(() => {
    // Create mock backend agent
    mockBackendAgent = {
      clone: vi.fn(() => ({
        messages: [],
        run: vi.fn(),
        abortRun: vi.fn(),
        abortController: {
          abort: vi.fn()
        }
      }))
    };
    
    // Create mock WebSocket
    mockWs = {
      send: vi.fn(),
      on: vi.fn(),
      readyState: 1
    };
    
    // Create mock Fastify instance
    mockFastify = {
      register: vi.fn(),
      log: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
      }
    };
    
    // Create TwilioAgent instance
    twilioAgent = new TwilioAgent({
      welcomeGreeting: 'Test greeting',
      wsPath: '/ws',
      backendAgent: mockBackendAgent,
      stateful: true
    });
  });
  
  describe('constructor', () => {
    it('should initialize with correct config', () => {
      expect(twilioAgent.welcomeGreeting).toBe('Test greeting');
      expect(twilioAgent.wsPath).toBe('/ws');
      expect(twilioAgent.backendAgent).toBe(mockBackendAgent);
      expect(twilioAgent.stateful).toBe(true);
    });
    
    it('should default stateful to true when not specified', () => {
      const agent = new TwilioAgent({
        welcomeGreeting: 'Test',
        backendAgent: mockBackendAgent
      });
      expect(agent.stateful).toBe(true);
    });
    
    it('should set stateful to false when explicitly set', () => {
      const agent = new TwilioAgent({
        welcomeGreeting: 'Test',
        backendAgent: mockBackendAgent,
        stateful: false
      });
      expect(agent.stateful).toBe(false);
    });
  });
  
  describe('handleAgentEvent', () => {
    let mockAgent;
    
    beforeEach(() => {
      mockAgent = {
        messages: []
      };
    });
    
    it('should handle TEXT_MESSAGE_START event', () => {
      const event = {
        type: 'TEXT_MESSAGE_START',
        messageId: 'msg-123'
      };
      
      twilioAgent.handleAgentEvent(event, mockWs, mockAgent);
      
      expect(mockAgent._currentMessageId).toBe('msg-123');
      expect(mockAgent._currentContent).toBe('');
    });
    
    it('should handle TEXT_MESSAGE_CONTENT event', () => {
      const event = {
        type: 'TEXT_MESSAGE_CONTENT',
        delta: 'Hello '
      };
      
      twilioAgent.handleAgentEvent(event, mockWs, mockAgent);
      
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'text',
        token: 'Hello ',
        last: false
      }));
      expect(mockAgent._currentContent).toBe('Hello ');
    });
    
    it('should handle TEXT_MESSAGE_END event in stateful mode', () => {
      mockAgent._currentMessageId = 'msg-123';
      mockAgent._currentContent = 'Hello world';
      
      const event = {
        type: 'TEXT_MESSAGE_END'
      };
      
      twilioAgent.handleAgentEvent(event, mockWs, mockAgent);
      
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'text',
        token: '',
        last: true
      }));
      
      expect(mockAgent.messages).toHaveLength(1);
      expect(mockAgent.messages[0]).toEqual({
        id: 'msg-123',
        role: 'assistant',
        content: 'Hello world'
      });
      
      expect(mockAgent._currentMessageId).toBeUndefined();
      expect(mockAgent._currentContent).toBeUndefined();
    });
    
    it('should handle TEXT_MESSAGE_END event in stateless mode', () => {
      twilioAgent.stateful = false;
      mockAgent._currentMessageId = 'msg-123';
      mockAgent._currentContent = 'Hello world';

      const event = {
        type: 'TEXT_MESSAGE_END'
      };

      twilioAgent.handleAgentEvent(event, mockWs, mockAgent);

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'text',
        token: '',
        last: true
      }));

      // In stateless mode, messages should not be stored
      expect(mockAgent.messages).toHaveLength(0);
    });

    it('should handle TEXT_MESSAGE_CHUNK event with messageId', () => {
      const event = {
        type: 'TEXT_MESSAGE_CHUNK',
        messageId: 'msg-456',
        delta: 'Complete message',
        role: 'assistant'
      };

      twilioAgent.handleAgentEvent(event, mockWs, mockAgent);

      // Should send the content token
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'text',
        token: 'Complete message',
        last: false
      }));

      // Should send the end token
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'text',
        token: '',
        last: true
      }));

      // Should store in message history (stateful mode)
      expect(mockAgent.messages).toHaveLength(1);
      expect(mockAgent.messages[0]).toEqual({
        id: 'msg-456',
        role: 'assistant',
        content: 'Complete message'
      });
    });

    it('should handle TEXT_MESSAGE_CHUNK event without messageId', () => {
      const event = {
        type: 'TEXT_MESSAGE_CHUNK',
        delta: 'Message without ID'
      };

      twilioAgent.handleAgentEvent(event, mockWs, mockAgent);

      // Should send the content token
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'text',
        token: 'Message without ID',
        last: false
      }));

      // Should send the end token
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'text',
        token: '',
        last: true
      }));

      // Should store in message history with generated ID
      expect(mockAgent.messages).toHaveLength(1);
      expect(mockAgent.messages[0]).toMatchObject({
        role: 'assistant',
        content: 'Message without ID'
      });
      expect(mockAgent.messages[0].id).toBeDefined();
    });

    it('should handle TEXT_MESSAGE_CHUNK event with empty delta', () => {
      const event = {
        type: 'TEXT_MESSAGE_CHUNK',
        messageId: 'msg-789',
        delta: ''
      };

      twilioAgent.handleAgentEvent(event, mockWs, mockAgent);

      // Should only send the end token (no content)
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'text',
        token: '',
        last: true
      }));

      // Should store empty message in history
      expect(mockAgent.messages).toHaveLength(1);
      expect(mockAgent.messages[0]).toEqual({
        id: 'msg-789',
        role: 'assistant',
        content: ''
      });
    });

    it('should handle TEXT_MESSAGE_CHUNK in stateless mode', () => {
      twilioAgent.stateful = false;

      const event = {
        type: 'TEXT_MESSAGE_CHUNK',
        messageId: 'msg-999',
        delta: 'Stateless chunk'
      };

      twilioAgent.handleAgentEvent(event, mockWs, mockAgent);

      // Should send tokens to Twilio
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'text',
        token: 'Stateless chunk',
        last: false
      }));

      // Should NOT store in message history (stateless mode)
      expect(mockAgent.messages).toHaveLength(0);
    });
  });
  
  describe('handleInterrupt', () => {
    it('should truncate assistant message at interrupt point', () => {
      const agent = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Let me help you with that. First, I will' }
        ]
      };
      
      twilioAgent.handleInterrupt(agent, 'Let me help you');
      
      expect(agent.messages[1].content).toBe('Let me help you');
    });
    
    it('should handle no messages gracefully', () => {
      const agent = { messages: [] };
      
      // Should not throw
      expect(() => {
        twilioAgent.handleInterrupt(agent, 'test');
      }).not.toThrow();
    });
    
    it('should truncate in-progress content', () => {
      const agent = {
        messages: [],
        _currentContent: 'This is a long response that will be interrupted'
      };
      
      twilioAgent.handleInterrupt(agent, 'This is a long');
      
      expect(agent._currentContent).toBe('This is a long');
    });
  });
  
  describe('WebSocket message handling', () => {
    let wsHandler;
    let messageHandler;
    let capturedFastify;
    
    beforeEach(async () => {
      // Capture the WebSocket route handler
      twilioAgent.attachToServer(mockFastify);
      const registerCall = mockFastify.register.mock.calls[1][0];
      
      // Create a mock to capture the WebSocket handler
      const mockInnerFastify = {
        get: vi.fn((path, options, handler) => {
          wsHandler = handler;
          // The handler will be called with the fastify instance in its closure
          capturedFastify = mockInnerFastify;
        }),
        log: mockFastify.log
      };
      
      // Execute the async registration function
      await registerCall(mockInnerFastify);
    });
    
    it('should handle setup message and set threadId to callSid', async () => {
      // Create an EventEmitter to simulate WebSocket
      const ws = new EventEmitter();
      ws.send = vi.fn();
      
      // Call the WebSocket handler
      wsHandler(ws, { headers: {} });
      
      // Simulate setup message
      const setupMessage = {
        type: 'setup',
        callSid: 'CA123456789'
      };
      
      ws.emit('message', JSON.stringify(setupMessage));
      
      // Check that agent was created with threadId set to callSid
      const agent = twilioAgent.agentInstances.get('CA123456789');
      expect(agent).toBeDefined();
      expect(agent.threadId).toBe('CA123456789');
      expect(mockBackendAgent.clone).toHaveBeenCalled();
    });
    
    it('should handle prompt message in stateful mode', async () => {
      const ws = new EventEmitter();
      ws.send = vi.fn();
      
      wsHandler(ws, { headers: {} });
      
      // Setup first
      ws.emit('message', JSON.stringify({
        type: 'setup',
        callSid: 'CA123'
      }));
      
      const agent = twilioAgent.agentInstances.get('CA123');
      agent.run = vi.fn(() => ({
        subscribe: vi.fn()
      }));
      
      // Send prompt
      ws.emit('message', JSON.stringify({
        type: 'prompt',
        voicePrompt: 'Hello there'
      }));
      
      // Check that message was added to history
      expect(agent.messages).toHaveLength(1);
      expect(agent.messages[0]).toMatchObject({
        role: 'user',
        content: 'Hello there'
      });
      
      // Check that run was called with all messages
      expect(agent.run).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'CA123',
          messages: agent.messages
        })
      );
    });
    
    it('should handle prompt message in stateless mode', async () => {
      twilioAgent.stateful = false;
      
      const ws = new EventEmitter();
      ws.send = vi.fn();
      
      wsHandler(ws, { headers: {} });
      
      // Setup first
      ws.emit('message', JSON.stringify({
        type: 'setup',
        callSid: 'CA123'
      }));
      
      const agent = twilioAgent.agentInstances.get('CA123');
      agent.run = vi.fn(() => ({
        subscribe: vi.fn()
      }));
      
      // Send prompt
      ws.emit('message', JSON.stringify({
        type: 'prompt',
        voicePrompt: 'Hello there'
      }));
      
      // In stateless mode, messages should not accumulate
      expect(agent.messages).toHaveLength(0);
      
      // Check that run was called with only current message
      expect(agent.run).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'CA123',
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'Hello there'
            })
          ])
        })
      );
      
      expect(agent.run.mock.calls[0][0].messages).toHaveLength(1);
    });
    
    it('should handle interrupt message', async () => {
      const ws = new EventEmitter();
      ws.send = vi.fn();
      
      wsHandler(ws, { headers: {} });
      
      // Setup first
      ws.emit('message', JSON.stringify({
        type: 'setup',
        callSid: 'CA123'
      }));
      
      const agent = twilioAgent.agentInstances.get('CA123');
      agent.abortRun = vi.fn();
      
      // Mock an active subscription
      const mockSubscription = {
        unsubscribe: vi.fn()
      };
      
      // Simulate an active run by setting up the handler's closure
      agent.run = vi.fn(() => mockSubscription);
      
      // Start a prompt first
      ws.emit('message', JSON.stringify({
        type: 'prompt',
        voicePrompt: 'Tell me a story'
      }));
      
      // Send interrupt
      ws.emit('message', JSON.stringify({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Once upon a'
      }));
      
      // Check abort was called
      expect(agent.abortRun).toHaveBeenCalled();
      
      // Check final message was sent
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'text',
        token: '',
        last: true
      }));
    });
  });
});