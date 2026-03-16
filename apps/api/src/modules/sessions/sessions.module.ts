import { Global, Module } from '@nestjs/common';
import { RecentReauthGuard } from '../../common/guards/recent-reauth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Global()
@Module({
  controllers: [SessionsController],
  providers: [SessionsService, SessionAuthGuard, RecentReauthGuard],
  exports: [SessionsService, SessionAuthGuard, RecentReauthGuard],
})
export class SessionsModule {}

