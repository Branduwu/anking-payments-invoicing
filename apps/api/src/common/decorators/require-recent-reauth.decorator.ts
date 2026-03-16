import { SetMetadata } from '@nestjs/common';

export const REQUIRES_RECENT_REAUTH_KEY = 'requiresRecentReauth';

export const RequireRecentReauth = () => SetMetadata(REQUIRES_RECENT_REAUTH_KEY, true);

