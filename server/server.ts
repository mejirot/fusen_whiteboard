import { timingSafeEqual } from 'node:crypto'

import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'

import { AppError, isAppError } from './domain/errors.js'
import { registerBoardRoutes } from './http/routes/board-routes.js'
import type { BoardWorkspaceStore } from './storage/workspace-store.js'

const MAX_BODY_BYTES = 50 * 1024 * 1024
const MIN_TOKEN_LENGTH = 32
const SESSION_COOKIE = 'fusen_session'

export interface LocalServerOptions {
  store: BoardWorkspaceStore
  token: string
  host: '127.0.0.1'
  port: number
  staticRoot?: string
  browserSessionToken?: string
  /** Extra Origins allowed (e.g. Vite dev server). */
  allowedOrigins?: string[]
}

export function createLocalServer(options: LocalServerOptions): FastifyInstance {
  assertServerToken(options.token)
  const app = Fastify({
    logger: false,
    trustProxy: false,
    bodyLimit: MAX_BODY_BYTES,
    forceCloseConnections: true,
  })

  const expectedHost = `${options.host}:${options.port}`
  const expectedOrigin = `http://${expectedHost}`
  const allowedOrigins = new Set([
    expectedOrigin,
    ...(options.allowedOrigins ?? []),
  ])

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body)
    },
  )

  app.addContentTypeParser(
    /^image\//,
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body)
    },
  )

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'",
    )
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store')
    }
    return payload
  })

  if (options.staticRoot !== undefined) {
    void app.register(fastifyStatic, {
      root: options.staticRoot,
      prefix: '/',
      index: false,
      redirect: false,
    })
    app.get('/', async (_request, reply) => {
      if (options.browserSessionToken !== undefined) {
        reply.header(
          'Set-Cookie',
          browserSessionCookie(options.browserSessionToken),
        )
      }
      reply.header('Cache-Control', 'no-store')
      return reply.type('text/html; charset=utf-8').sendFile('index.html')
    })
  }

  app.addHook('onRequest', async (request) => {
    if (request.url === '/api/session') return
    if (!request.url.startsWith('/api/')) return

    const bearerAuthorized = matchesBearerToken(
      request.headers.authorization,
      options.token,
    )
    const sessionAuthorized = matchesBrowserSession(
      request.headers.cookie,
      options.browserSessionToken,
    )
    if (!bearerAuthorized && !sessionAuthorized) {
      throw new AppError(
        'UNAUTHORIZED',
        '有効なBearerトークンまたはセッションが必要です。',
        401,
      )
    }

    const hostOk =
      request.headers.host === expectedHost ||
      (options.allowedOrigins !== undefined &&
        typeof request.headers.host === 'string' &&
        isLocalDevHost(request.headers.host))
    if (!hostOk) {
      throw new AppError('FORBIDDEN', '許可されていないHostヘッダーです。', 403)
    }

    const origin = request.headers.origin
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      throw new AppError('FORBIDDEN', '許可されていないOriginです。', 403)
    }
    if (
      sessionAuthorized &&
      !bearerAuthorized &&
      isStateChangingMethod(request.method) &&
      (origin === undefined || !allowedOrigins.has(origin))
    ) {
      throw new AppError(
        'FORBIDDEN',
        'ブラウザからの更新には同一Originが必要です。',
        403,
      )
    }
  })

  app.get('/health', async () => ({ status: 'ok', service: 'fusen-whiteboard' }))

  app.get('/api/session', async (request, reply) => {
    const origin = request.headers.origin
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      throw new AppError('FORBIDDEN', '許可されていないOriginです。', 403)
    }
    if (options.browserSessionToken === undefined) {
      throw new AppError(
        'IO',
        'ブラウザセッションが設定されていません。',
        500,
      )
    }
    reply.header('Set-Cookie', browserSessionCookie(options.browserSessionToken))
    return { ok: true }
  })

  registerBoardRoutes(app, options.store)

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      })
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      error.validation !== undefined
    ) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'リクエストの形式が不正です。' },
      })
    }
    process.stderr.write(
      `[fusen] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    )
    return reply.status(500).send({
      error: {
        code: 'IO',
        message: 'ローカルサービスで予期しないエラーが発生しました。',
      },
    })
  })

  return app
}

function matchesBearerToken(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  if (authorization === undefined || !authorization.startsWith('Bearer ')) {
    return false
  }
  return tokensMatch(authorization.slice('Bearer '.length), expectedToken)
}

function matchesBrowserSession(
  cookieHeader: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (cookieHeader === undefined || expectedToken === undefined) return false
  const provided = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(`${SESSION_COOKIE}=`.length)
  return provided !== undefined && tokensMatch(provided, expectedToken)
}

function browserSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`
}

function tokensMatch(providedToken: string, expectedToken: string): boolean {
  const provided = Buffer.from(providedToken)
  const expected = Buffer.from(expectedToken)
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  )
}

function isStateChangingMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

function isLocalDevHost(host: string): boolean {
  return (
    host.startsWith('127.0.0.1:') ||
    host.startsWith('localhost:')
  )
}

function assertServerToken(value: string): void {
  if (
    value.length < MIN_TOKEN_LENGTH ||
    value.length > 4096 ||
    /[\r\n]/.test(value)
  ) {
    throw new Error(
      'Bearer token must be 32-4096 characters without line breaks.',
    )
  }
}
