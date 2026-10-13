// A local OpenAI-compatible server. Spoon talks to it through a custom AI endpoint, so the
// AI features can be tested end to end without real accounts or network access.
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeAiRequest {
  path: string
  auth?: string
  body: { model?: string; messages?: { role: string; content: string }[]; max_tokens?: number }
}

export type FakeReply = string | { status: number; error: string }

export async function startFakeAi(reply: (req: FakeAiRequest) => FakeReply = () => 'feat: fake commit message') {
  const requests: FakeAiRequest[] = []
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = ''
      req.on('data', (chunk) => (data += chunk))
      req.on('end', () => resolve(data))
    })
  const server = createServer(async (req, res) => {
    const raw = await read(req)
    const path = (req.url ?? '').replace(/\?.*$/, '')
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && path.endsWith('/models')) {
      res.end(JSON.stringify({ data: [{ id: 'fake-small' }, { id: 'fake-large' }] }))
      return
    }
    if (req.method === 'POST' && path.endsWith('/chat/completions')) {
      const entry: FakeAiRequest = { path, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : {} }
      requests.push(entry)
      const out = reply(entry)
      if (typeof out === 'string') {
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: out } }] }))
      } else {
        res.statusCode = out.status
        res.end(JSON.stringify({ error: { message: out.error } }))
      }
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
