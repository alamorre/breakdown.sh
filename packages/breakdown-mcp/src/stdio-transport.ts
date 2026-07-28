import process from 'node:process';
import type { Readable, Writable } from 'node:stream';

import {
  ErrorCode,
  JSONRPCMessageSchema,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function responseId(value: unknown): string | number | null {
  if (!isRecord(value)) return null;
  return typeof value.id === 'string' || typeof value.id === 'number' ? value.id : null;
}

export class BreakdownStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private buffer = Buffer.alloc(0);
  private started = false;
  private closed = false;
  private writeChain = Promise.resolve();
  private readonly initializeRequestIds = new Set<string | number>();

  constructor(
    private readonly input: Readable = process.stdin,
    private readonly output: Writable = process.stdout,
  ) {}

  private readonly onData = (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, bytes]);
    this.processBuffer();
  };

  private readonly onInputError = (error: Error) => {
    this.onerror?.(error);
    void this.close();
  };

  private readonly onOutputError = (error: Error) => {
    this.onerror?.(error);
    void this.close();
  };

  private readonly onEnd = () => {
    void this.close();
  };

  async start() {
    if (this.started) throw new Error('Breakdown stdio transport is already started.');
    this.started = true;
    this.input.on('data', this.onData);
    this.input.on('error', this.onInputError);
    this.input.on('end', this.onEnd);
    this.input.on('close', this.onEnd);
    this.output.on('error', this.onOutputError);
  }

  private processBuffer() {
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      this.processLine(line.at(-1) === 0x0d ? line.subarray(0, -1) : line);
    }
  }

  private processLine(line: Buffer) {
    let value: unknown;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(line);
      value = JSON.parse(text) as unknown;
    } catch {
      this.sendProtocolError(null, ErrorCode.ParseError, 'Parse error');
      return;
    }

    const parsed = JSONRPCMessageSchema.safeParse(value);
    if (!parsed.success) {
      this.sendProtocolError(responseId(value), ErrorCode.InvalidRequest, 'Invalid Request');
      return;
    }
    const message = parsed.data;
    if (
      'method' in message &&
      message.method === 'initialize' &&
      'id' in message &&
      (typeof message.id === 'string' || typeof message.id === 'number')
    ) {
      this.initializeRequestIds.add(message.id);
    }
    if (
      'method' in message &&
      message.method === 'notifications/cancelled' &&
      isRecord(message.params) &&
      (typeof message.params.requestId === 'string' ||
        typeof message.params.requestId === 'number') &&
      this.initializeRequestIds.has(message.params.requestId)
    ) {
      return;
    }
    this.onmessage?.(message);
  }

  private sendProtocolError(id: string | number | null, code: number, message: string) {
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    } as unknown as JSONRPCMessage;
    void this.send(response).catch((error: unknown) => {
      this.onerror?.(error instanceof Error ? error : new Error('Could not write JSON-RPC error.'));
    });
  }

  async send(message: JSONRPCMessage) {
    if (this.closed) throw new Error('The stdio connection is closed.');
    if (
      'id' in message &&
      (typeof message.id === 'string' || typeof message.id === 'number') &&
      this.initializeRequestIds.has(message.id)
    ) {
      this.initializeRequestIds.delete(message.id);
    }
    const line = `${JSON.stringify(message)}\n`;
    const write = this.writeChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            this.output.off('error', onError);
            reject(error);
          };
          this.output.once('error', onError);
          this.output.write(line, (error) => {
            this.output.off('error', onError);
            if (error) reject(error);
            else resolve();
          });
        }),
    );
    this.writeChain = write.catch(() => undefined);
    await write;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.input.off('data', this.onData);
    this.input.off('error', this.onInputError);
    this.input.off('end', this.onEnd);
    this.input.off('close', this.onEnd);
    this.output.off('error', this.onOutputError);
    if (this.input.listenerCount('data') === 0) this.input.pause();
    this.buffer = Buffer.alloc(0);
    this.initializeRequestIds.clear();
    this.onclose?.();
  }
}
