import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import { NextRequest, NextResponse } from 'next/server'

// This route is public (the wallet calls it before sign-in), so it only forwards
// the LCD reads and the simulate call the wallet and UI make, not any path on
// the node. EXACT paths must match as a whole; CHILD paths need at least one
// more segment (an address), so the bare account/balance listings stay closed.
const ALLOWED_PATHS: Record<string, { exact: string[]; child: string[] }> = {
  GET: {
    exact: [
      'cosmos/base/tendermint/v1beta1/blocks/latest',
      'pokt-network/poktroll/service/service',
    ],
    child: [
      'cosmos/bank/v1beta1/balances',
      'cosmos/auth/v1beta1/accounts',
    ],
  },
  POST: {
    exact: ['cosmos/tx/v1beta1/simulate'],
    child: [],
  },
}

// Each segment is a plain token (addresses, service ids, path words). This also
// refuses '.', '..', '%' (so no encoded or double-encoded traversal) and any
// slash or backslash decoded into a segment.
const SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/

function isAllowedRpcPath(method: string, segments: string[]): boolean {
  if (segments.length === 0) return false
  if (segments.some((s) => !SEGMENT_PATTERN.test(s) || s === '.' || s === '..')) return false

  const path = segments.join('/')
  const allowed = ALLOWED_PATHS[method]
  if (!allowed) return false
  return allowed.exact.includes(path) || allowed.child.some((prefix) => path.startsWith(`${prefix}/`))
}

async function proxyToRpc(request: NextRequest, segments: string[]) {
  if (!isAllowedRpcPath(request.method, segments)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const path = segments.join('/')
  const settings = await getApplicationSettings()
  const rpcUrl = settings.pocketApiUrl

  if (!rpcUrl) {
    return NextResponse.json({ error: 'RPC URL not configured' }, { status: 503 })
  }

  const targetUrl = `${rpcUrl.replace(/\/$/, '')}/${path}`
  const searchParams = request.nextUrl.searchParams.toString()
  const fullUrl = searchParams ? `${targetUrl}?${searchParams}` : targetUrl

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const fetchOptions: RequestInit = {
    method: request.method,
    headers,
  }

  if (request.method === 'POST') {
    fetchOptions.body = await request.text()
  }

  const response = await fetch(fullUrl, fetchOptions)
  const data = await response.text()

  return new NextResponse(data, {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params
  return proxyToRpc(request, path)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params
  return proxyToRpc(request, path)
}
