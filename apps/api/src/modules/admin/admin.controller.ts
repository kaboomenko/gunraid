import { Controller, Get } from '@nestjs/common';
import { Auth, CurrentUser, RateLimit, type AuthContext } from '../../common/auth.decorators.js';

/** Админка: доступ по ролям. Разделы появятся на этапе 7. */
@Controller('admin')
@Auth({ roles: ['support', 'admin'] })
@RateLimit('admin')
export class AdminController {
  @Get('ping')
  ping(@CurrentUser() user: AuthContext) {
    return { ok: true, role: user.role };
  }
}
