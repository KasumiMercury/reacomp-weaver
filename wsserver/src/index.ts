import {Hono} from 'hono'
import {upgradeWebSocket} from "hono/cloudflare-workers";

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.get(
    '/signaling',
    upgradeWebSocket((c) => {
      return {
        onMessage: (evt, ws) => {
          ws.send('Received: ' + evt.data)
        },
        onClose: () => {
          console.log('WebSocket connection closed')
        },
        onError: (err) => {
          console.error('WebSocket error:', err)
        }
      }
    })
)

export default app
