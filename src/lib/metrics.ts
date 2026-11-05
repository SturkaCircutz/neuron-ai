import type { FastifyInstance } from 'fastify';

export function registerMetrics(app: FastifyInstance, gauges: () => Record<string, number>) {
  const requests = new Map<string, number>();

  app.addHook('onResponse', async (req, reply) => {
    const key = `method="${req.method}",route="${req.routeOptions.url ?? 'unmatched'}",status="${reply.statusCode}"`;
    requests.set(key, (requests.get(key) ?? 0) + 1);
  });

  app.get('/metrics', async (_req, reply) => {
    const lines = ['# TYPE http_requests_total counter'];
    for (const [labels, n] of requests) lines.push(`http_requests_total{${labels}} ${n}`);
    for (const [name, value] of Object.entries(gauges())) lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
    reply.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });
}
