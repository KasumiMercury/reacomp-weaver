import {DurableObject} from "cloudflare:workers";
import type {Env} from "hono";

interface SignalDurableObjectConfig {
  heartbeatInterval: number;
  maxReconnectAttempts: number;
}

type SessionData = {
  websocket: WebSocket
  subscribedTopics: Set<string>
  alive: boolean
  quit: boolean
  intervalId?: number
}

type WebSocketMessageType = 'ping' | 'pong' | 'publish' | 'subscribe' | 'unsubscribe';

interface BaseMessage {
  type: WebSocketMessageType;
}

interface SubscribeMessage extends BaseMessage {
  type: 'subscribe';
  topics: string[];
}

interface UnsubscribeMessage extends BaseMessage {
  type: 'unsubscribe';
  topics: string[];
}

interface PublishMessage extends BaseMessage {
  type: 'publish';
  topic: string;
  [key: string]: any;
}

interface PingMessage extends BaseMessage {
  type: 'ping';
}

interface PongMessage extends BaseMessage {
  type: 'pong';
}

type WebSocketMessage = SubscribeMessage | UnsubscribeMessage | PublishMessage | PingMessage | PongMessage;

interface PublishMessageWithClients extends PublishMessage {
  clients: number;
}

export class SignalDurableObject extends DurableObject<Env> {
  state: DurableObjectState
  sessions: Map<WebSocket, SessionData>
  topics: Map<string, Set<WebSocket>>
  private readonly config: SignalDurableObjectConfig

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.state = ctx;
    this.sessions = new Map();
    this.topics = new Map();
    this.config = {
      heartbeatInterval: 30000,
      maxReconnectAttempts: 3
    };
  }

  async fetch(): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    await this.handleSession(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async handleSession(ws: WebSocket): Promise<void> {
    ws.accept()

    const session: SessionData = {
      websocket: ws,
      subscribedTopics: new Set(),
      alive: true,
      quit: false,
    };

    this.sessions.set(ws, session);

    const pingInterval = setInterval(() => {
      if (!session.alive) {
        this.closeSession(ws);
        clearInterval(pingInterval);
      } else {
        session.alive = false;
        try {
          this.send(ws, {type: 'ping'});
        } catch (err) {
          this.handleError('Error sending ping', err);
          this.closeSession(ws);
          clearInterval(pingInterval);
        }
      }
    }, this.config.heartbeatInterval);
    
    session.intervalId = pingInterval;

    ws.addEventListener('close', () => {
      this.cleanupSession(session);
      this.closeSession(ws);
    })

    ws.addEventListener('error', (err) => {
      this.handleError('WebSocket error', err);
      this.cleanupSession(session);
      this.closeSession(ws);
    })

    ws.addEventListener('message', async (message) => {
        try {
            const parsedMessage = this.parseMessage(message.data);
            if (parsedMessage) {
                await this.handleMessage(ws, parsedMessage, session);
            }
        } catch (err) {
            this.handleError('Error handling message', err);
        }
    })
  }

  private parseMessage(data: string): WebSocketMessage | null {
    try {
      const parsed = JSON.parse(data);
      if (!this.isValidMessage(parsed)) {
        this.handleError('Invalid message format', new Error('Message does not match expected schema'));
        return null;
      }
      return parsed;
    } catch (err) {
      this.handleError('Failed to parse message', err);
      return null;
    }
  }

  private isValidMessage(obj: any): obj is WebSocketMessage {
    if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') {
      return false;
    }

    const validTypes: WebSocketMessageType[] = ['ping', 'pong', 'publish', 'subscribe', 'unsubscribe'];
    if (!validTypes.includes(obj.type)) {
      return false;
    }

    switch (obj.type) {
      case 'subscribe':
      case 'unsubscribe':
        return Array.isArray(obj.topics) && obj.topics.every((t: any) => typeof t === 'string');
      case 'publish':
        return typeof obj.topic === 'string';
      case 'ping':
      case 'pong':
        return true;
      default:
        return false;
    }
  }

  async handleMessage(
      ws: WebSocket,
      message: WebSocketMessage,
      session: SessionData
  ) {
    if (session.quit) return;

    switch (message.type) {
      case "subscribe":
        this.handleSubscribe(ws, message.topics, session);
        break;
      case "unsubscribe":
        this.handleUnsubscribe(ws, message.topics, session);
        break;
      case "publish":
        this.handlePublish(message);
        break;
      case "ping":
        await this.send(ws, {type: "pong"});
        break;
      case "pong":
        session.alive = true;
        break;
    }
  }

  handleSubscribe(
      ws: WebSocket,
      topics: string[],
      session: SessionData
  ) {
    topics.forEach((topic) => {
      this.addSubscription(ws, topic, session);
    })
  }

  handleUnsubscribe(
      ws: WebSocket,
      topics: string[],
      session: SessionData
  ) {
    topics.forEach((topic) => {
      this.removeSubscription(ws, topic, session);
    })
  }

  private addSubscription(ws: WebSocket, topic: string, session: SessionData): void {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, new Set<WebSocket>());
    }
    this.topics.get(topic)!.add(ws);
    session.subscribedTopics.add(topic);
  }

  private removeSubscription(ws: WebSocket, topic: string, session: SessionData): void {
    const subscribers = this.topics.get(topic);
    if (subscribers) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        this.topics.delete(topic);
      }
    }
    session.subscribedTopics.delete(topic);
  }

  handlePublish(message: PublishMessage) {
    const receivers = this.topics.get(message.topic);
    if (!receivers || receivers.size === 0) return;

    const publishMessage: PublishMessageWithClients = {
      ...message,
      clients: receivers.size
    };
    
    receivers.forEach(receiver => {
      this.send(receiver, publishMessage);
    })
  }

  async send(ws: WebSocket, message: any) {
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      this.handleError('Error sending message', err);
    }
  }

  private handleError(message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${message}:`, errorMessage);
  }

  private cleanupSession(session: SessionData): void {
    if (session.intervalId) {
      clearInterval(session.intervalId);
      session.intervalId = undefined;
    }
  }

  async closeSession(ws: WebSocket) {
    const session = this.sessions.get(ws);
    if (!session) return;

    session.quit = true;
    this.cleanupSession(session);

    session.subscribedTopics.forEach((topic) => {
      this.removeSubscription(ws, topic, session);
    })

    this.sessions.delete(ws);

    try {
      ws.close();
    } catch {
      // already closed
    }
  }
}