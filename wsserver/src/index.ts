import {Hono} from 'hono'
import {upgradeWebSocket} from "hono/cloudflare-workers";
import {cors} from "hono/cors";

type Env = {
  Bindings: {
    SIGNALING_ROOM: DurableObjectNamespace
  }
}

const app = new Hono<Env>()

// app.get('/*', cors())

app.get('/', (c) => c.text('okay'))

app.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade')
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
  }

  const roomId = c.env.SIGNALING_ROOM.idFromName('global-room')
  const roomObject = c.env.SIGNALING_ROOM.get(roomId)

  const url = new URL(c.req.url)
  url.protocol = 'https:'
  return roomObject.fetch(url.toString(), c.req.raw)
})

export { SignalDurableObject } from './SignalDurableObject'
export default app
