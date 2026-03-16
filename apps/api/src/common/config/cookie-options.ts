import { ConfigService } from '@nestjs/config';

export const getSessionCookieOptions = (configService: ConfigService) => ({
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: configService.get<boolean>('app.cookie.secure', { infer: true }) ?? false,
  path: configService.get<string>('app.cookie.path', { infer: true }) ?? '/',
});

