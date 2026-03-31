import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import { NextRequest, NextResponse } from 'next/server'

async function proxyToRpc(request: NextRequest, path: string) {
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
  return proxyToRpc(request, path.join('/'))
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params
  return proxyToRpc(request, path.join('/'))
}
