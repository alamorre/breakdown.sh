import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  createBreakdownMcpServer,
  createBreakdownSetupMcpServer,
} from '@/lib/mcp/breakdown-server';
import { resolveHeadlessActor } from '@/lib/breakdown-service/actor';
import type { BreakdownActor } from '@/lib/breakdown-service/actor';
import { getErrorResponse } from '@/lib/breakdown-service/errors';
import { checkHeadlessRateLimit } from '@/lib/breakdown-service/safety';
import {
  CODEX_DIAGNOSTIC_TOOL,
  createCodexAuthFailureDiagnostics,
} from '@/lib/headless/codex-diagnostics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, Mcp-Session-Id, Last-Event-ID, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate',
};

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function originFor(request: Request) {
  return new URL(request.url).origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSetupDiagnosticMessage(message: unknown) {
  if (!isRecord(message)) {
    return false;
  }

  const method = message.method;
  if (
    method === 'initialize' ||
    method === 'tools/list' ||
    method === 'notifications/initialized'
  ) {
    return true;
  }

  if (method !== 'tools/call' || !isRecord(message.params)) {
    return false;
  }

  return message.params.name === CODEX_DIAGNOSTIC_TOOL;
}

async function shouldUseSetupDiagnosticServer(request: Request) {
  if (request.method !== 'POST') {
    return false;
  }

  const body = await request
    .clone()
    .json()
    .catch(() => null);
  const messages = Array.isArray(body) ? body : [body];
  return messages.length > 0 && messages.every(isSetupDiagnosticMessage);
}

function mcpErrorResponse(
  status: number,
  code: number,
  message: string,
  options: { details?: unknown; headers?: HeadersInit } = {},
) {
  return withCors(
    Response.json(
      {
        jsonrpc: '2.0',
        error: {
          code,
          message,
          ...(options.details === undefined ? {} : { data: options.details }),
        },
        id: null,
      },
      {
        status,
        headers: options.headers,
      },
    ),
  );
}

function actorAuthInfo(actor: BreakdownActor): AuthInfo {
  return {
    token: actor.tokenId ?? actor.userId,
    clientId: actor.clientId ?? actor.tokenName ?? actor.source,
    scopes: actor.scopes,
    extra: {
      source: actor.source,
      userId: actor.userId,
      tokenName: actor.tokenName,
    },
  };
}

async function resolveMcpActor(request: Request) {
  const actor = await resolveHeadlessActor(request, []);
  checkHeadlessRateLimit(actor);
  return actor;
}

async function handleSetupDiagnosticRequest(request: Request, diagnostics: unknown) {
  const server = createBreakdownSetupMcpServer(diagnostics);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return withCors(await transport.handleRequest(request));
}

async function handleMcpRequest(request: Request) {
  const origin = originFor(request);
  let actor: BreakdownActor;
  try {
    actor = await resolveMcpActor(request);
  } catch (err) {
    const error = getErrorResponse(err);
    if (await shouldUseSetupDiagnosticServer(request)) {
      return handleSetupDiagnosticRequest(request, createCodexAuthFailureDiagnostics(err, origin));
    }

    return mcpErrorResponse(error.status, error.status === 401 ? -32001 : -32000, error.message, {
      details: error.details,
      headers:
        error.status === 401
          ? {
              'WWW-Authenticate':
                'Bearer realm="Breakdown MCP", error="invalid_token", error_description="Valid integration token required"',
            }
          : undefined,
    });
  }

  try {
    const server = createBreakdownMcpServer(actor, { origin });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);
    const response = await transport.handleRequest(request, {
      authInfo: actorAuthInfo(actor),
    });
    return withCors(response);
  } catch (err) {
    const error = getErrorResponse(err);
    return mcpErrorResponse(error.status, -32603, error.message, { details: error.details });
  }
}

export async function OPTIONS() {
  return withCors(new Response(null, { status: 204 }));
}

export async function GET(request: Request) {
  return handleMcpRequest(request);
}

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request);
}
