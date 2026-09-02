import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

export type RequestObservation = {
  requestId: string;
  startedAt: number;
  marks: Array<{ name: string; at: number }>;
};

export function beginRequestObservation(): RequestObservation {
  return { requestId: randomUUID(), startedAt: performance.now(), marks: [] };
}

export function markRequest(observation: RequestObservation, name: string): void {
  observation.marks.push({ name: name.replace(/[^a-z0-9_-]/gi, '_'), at: performance.now() });
}

export function observeResponse<T>(observation: RequestObservation, response: NextResponse<T>): NextResponse<T> {
  const finishedAt = performance.now();
  let previous = observation.startedAt;
  const timings = observation.marks.map(mark => {
    const duration = Math.max(0, mark.at - previous);
    previous = mark.at;
    return `${mark.name};dur=${duration.toFixed(1)}`;
  });
  timings.push(`total;dur=${Math.max(0, finishedAt - observation.startedAt).toFixed(1)}`);
  response.headers.set('X-Request-Id', observation.requestId);
  response.headers.set('Server-Timing', timings.join(', '));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export function observedJson<T>(
  observation: RequestObservation,
  body: T,
  init?: ConstructorParameters<typeof NextResponse<T>>[1],
): NextResponse<T> {
  return observeResponse(observation, NextResponse.json(body, init));
}

