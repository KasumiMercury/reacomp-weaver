import {DurableObject} from "cloudflare:workers";
import type {Env} from "hono";

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

const pingTimeout = 30000

type SessionData = {
  websocket: WebSocket
  subscribedTopics: Set<string>
  closed: boolean
  pongReceived: boolean
  intervalId?: ReturnType<typeof setInterval>
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = ctx;
    this.sessions = new Map();
    this.topics = new Map();
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
      closed: false,
      pongReceived: true,
    };

    this.sessions.set(ws, session);
    this.setupPingPong(ws, session);
    this.setupEventListeners(ws, session);
  }

  private setupPingPong(ws: WebSocket, session: SessionData): void {
    const pingInterval = setInterval(() => {
      if (!session.pongReceived) {
        ws.close()
        clearInterval(pingInterval)
      } else {
        session.pongReceived = false
        try {
          this.send(ws, { type: 'ping' })
        } catch (e) {
          ws.close()
        }
      }
    }, pingTimeout)
    
    session.intervalId = pingInterval;
  }

  private setupEventListeners(ws: WebSocket, session: SessionData): void {
    ws.addEventListener('close', () => {
      this.cleanupSession(session);
      this.closeSession(ws);
    })

    ws.addEventListener('error', () => {
      this.cleanupSession(session);
      this.closeSession(ws);
    })

    ws.addEventListener('message', async (event) => {
      const parsedMessage = this.parseMessage(event.data);
      if (parsedMessage && !session.closed) {
        await this.handleMessage(ws, parsedMessage, session);
      }
    })
  }

  private parseMessage(data: any): WebSocketMessage | null {
    try {
      let message: any
      if (typeof data === 'string') {
        message = JSON.parse(data)
      } else {
        message = JSON.parse(new TextDecoder().decode(data))
      }
      // Lenient validation like sample - just check basic structure
      if (message && message.type) {
        return message;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async handleMessage(
      ws: WebSocket,
      message: WebSocketMessage,
      session: SessionData
  ) {
    if (session.closed) return;

    switch (message.type) {
      case "subscribe":
        this.handleSubscribe(ws, message.topics || [], session);
        break;
      case "unsubscribe":
        this.handleUnsubscribe(ws, message.topics || [], session);
        break;
      case "publish":
        this.handlePublish(message);
        break;
      case "ping":
        await this.send(ws, {type: "pong"});
        break;
      case "pong":
        session.pongReceived = true;
        break;
    }
  }

  handleSubscribe(
      ws: WebSocket,
      topics: string[],
      session: SessionData
  ) {
    topics.forEach((topicName) => {
      this.addSubscription(ws, topicName, session);
    })
  }

  handleUnsubscribe(
      ws: WebSocket,
      topics: string[],
      session: SessionData
  ) {
    topics.forEach((topicName) => {
      const subs = this.topics.get(topicName);
      if (subs) {
        subs.delete(ws);
      }
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
    if (!message.topic) return;
    
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
    if (ws.readyState !== wsReadyStateConnecting && ws.readyState !== wsReadyStateOpen) {
      ws.close()
      return
    }
    try {
      ws.send(JSON.stringify(message));
    } catch (e) {
      ws.close()
    }
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

    session.closed = true;
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