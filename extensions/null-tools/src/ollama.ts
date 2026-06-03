'use strict';

import * as http from 'http';

interface OllamaModel { name: string; }
interface OllamaTagsResponse { models: OllamaModel[]; }
interface OllamaGenerateChunk { response?: string; }
interface OllamaChatMessage { role: string; content: string; }
interface OllamaChatChunk { message?: { content?: string }; }

export function isAlive(): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.request(
      { method: 'GET', hostname: 'localhost', port: 11434, path: '/api/tags' },
      res => { res.resume(); resolve((res.statusCode ?? 500) < 500); }
    );
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

export function models(): Promise<string[]> {
  return new Promise(resolve => {
    const req = http.request(
      { method: 'GET', hostname: 'localhost', port: 11434, path: '/api/tags' },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as OllamaTagsResponse;
            resolve((data.models || []).map(m => m.name || String(m)));
          } catch { resolve([]); }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.setTimeout(5000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

export function generate(
  model: string,
  prompt: string,
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model, prompt, stream: true });
    const req = http.request(
      {
        method: 'POST', hostname: 'localhost', port: 11434, path: '/api/generate',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      res => {
        let full = '', buf = '';
        res.on('data', (chunk: Buffer) => {
          if (signal?.aborted) { req.destroy(); return; }
          buf += chunk.toString('utf8');
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line) as OllamaGenerateChunk;
              if (obj.response) { full += obj.response; onChunk?.(obj.response); }
            } catch {}
          }
        });
        res.on('end', () => resolve(full));
      }
    );
    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => req.destroy());
    req.write(payload);
    req.end();
  });
}

export function chat(
  model: string,
  messages: OllamaChatMessage[],
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model, messages, stream: true });
    const req = http.request(
      {
        method: 'POST', hostname: 'localhost', port: 11434, path: '/api/chat',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      res => {
        let full = '', buf = '';
        res.on('data', (chunk: Buffer) => {
          if (signal?.aborted) { req.destroy(); return; }
          buf += chunk.toString('utf8');
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj  = JSON.parse(line) as OllamaChatChunk;
              const text = obj.message?.content;
              if (text) { full += text; onChunk?.(text); }
            } catch {}
          }
        });
        res.on('end', () => resolve(full));
      }
    );
    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => req.destroy());
    req.write(payload);
    req.end();
  });
}
