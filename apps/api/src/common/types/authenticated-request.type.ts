import type { FastifyRequest } from 'fastify';
import type { ActiveSession } from '../../modules/sessions/session.types';

export type AuthenticatedRequest = FastifyRequest & {
  cookies: Record<string, string>;
  session?: ActiveSession;
  user?: {
    id: string;
  };
};

