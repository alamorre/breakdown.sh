import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createThesisMcpServer } from '@/lib/mcp/thesis-server';
import { resolveHeadlessActor } from '@/lib/thesis-service/actor';
import type { ThesisActor } from '@/lib/thesis-service/actor';
import { getErrorResponse } from '@/lib/thesis-service/errors';
import { checkHeadlessRateLimit } from '@/lib/thesis-service/safety';

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

function actorAuthInfo(actor: ThesisActor): AuthInfo {
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

async function handleMcpRequest(request: Request) {
  let actor: ThesisActor;
  try {
    actor = await resolveMcpActor(request);
  } catch (err) {
    const error = getErrorResponse(err);
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
    const server = createThesisMcpServer(actor);
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
