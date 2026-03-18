import type { FastifyRequest } from 'fastify';

export interface RequestMetadata {
  ipAddress?: string;
  requestId?: string;
  userAgent?: string;
}

export const getRequestMetadata = (request: FastifyRequest): RequestMetadata => ({
  ipAddress: request.ip,
  requestId: request.id,
  userAgent:
    typeof request.headers?.['user-agent'] === 'string'
      ? request.headers['user-agent']
      : undefined,
});
