import { randomBytes } from 'node:crypto';
import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import {
  API_PREFIX,
  COOKIES,
  devLoginSchema,
  sanitizeReturnTo,
  telegramAuthSchema,
  type AuthIntent,
  type AuthProvider,
  type DevLoginBody,
  type DevLoginPreset,
  type ErrorCode,
  type Role,
  type TelegramAuthPayload,
} from '@gunraid/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  isDevLoginEnabled,
  isGoogleEnabled,
  isTelegramEnabled,
  type Env,
} from '../../config/env.js';
import { ENV } from '../../core/tokens.js';
import { AppError, unauthorized } from '../../common/app-error.js';
import {
  Auth,
  CurrentUser,
  OptionalAuth,
  RateLimit,
  type AuthContext,
} from '../../common/auth.decorators.js';
import { getRequestMeta } from '../../common/http-context.js';
import { ZBody } from '../../common/zod.js';
import { UsersService } from '../users/users.service.js';
import { AuthService, type CompleteAuthInput } from './auth.service.js';
import { GoogleOAuth } from './providers/google.js';
import { buildSteamLoginUrl, fetchSteamProfile, verifySteamAssertion } from './providers/steam.js';
import { verifyTelegramAuth } from './providers/telegram.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

interface OAuthState extends Record<string, unknown> {
  p: AuthProvider;
  state: string;
  intent: AuthIntent;
  returnTo: string;
  linkUserId?: string | null;
  codeVerifier?: string;
}

const DEV_PRESETS: Record<DevLoginPreset, { nickname: string; role: Role }> = {
  player: { nickname: 'DevPlayer', role: 'user' },
  support: { nickname: 'DevSupport', role: 'support' },
  admin: { nickname: 'DevAdmin', role: 'admin' },
};

@Controller('auth')
export class AuthController {
  private readonly google: GoogleOAuth | null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly tokens: TokensService,
    private readonly users: UsersService,
  ) {
    this.google = isGoogleEnabled(env)
      ? new GoogleOAuth(
          env.GOOGLE_CLIENT_ID as string,
          env.GOOGLE_CLIENT_SECRET as string,
          `${env.PUBLIC_URL}${API_PREFIX}/auth/google/callback`,
        )
      : null;
  }

  /** Выдаёт cookie CSRF (ставится хуком на любой запрос к API). */
  @Get('csrf')
  csrf() {
    return { ok: true };
  }

  // ---------- Steam ----------

  @Get('steam')
  @OptionalAuth()
  @RateLimit('auth')
  async steamStart(
    @Query('intent') intentRaw: string | undefined,
    @Query('returnTo') returnToRaw: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { intent, returnTo } = this.parseStart(intentRaw, returnToRaw);
    if (intent === 'link' && !req.auth) return this.redirectError(reply, returnTo, 'UNAUTHORIZED');
    const state = randomBytes(16).toString('base64url');
    const callback = this.steamCallbackUrl(state);
    this.tokens.setStateCookie(
      reply,
      await this.tokens.signState({
        p: 'steam',
        state,
        intent,
        returnTo,
        linkUserId: req.auth?.userId ?? null,
      }),
    );
    return reply.redirect(buildSteamLoginUrl(callback, this.env.PUBLIC_URL), 302);
  }

  @Get('steam/callback')
  @RateLimit('auth')
  async steamCallback(
    @Query() query: Record<string, string | undefined>,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const st = await this.tokens.verifyState<OAuthState>(req.cookies[COOKIES.oauth]);
    this.tokens.clearStateCookie(reply);
    if (!st || st.p !== 'steam' || st.state !== query.state) {
      return this.redirectError(reply, st?.returnTo ?? '/', 'AUTH_FAILED');
    }
    const steamId = await verifySteamAssertion(query, this.steamCallbackUrl(st.state));
    if (!steamId) return this.redirectError(reply, st.returnTo, 'AUTH_FAILED');
    const profile = await fetchSteamProfile(steamId, this.env.STEAM_API_KEY);
    return this.finishRedirect(req, reply, st, {
      provider: 'steam',
      providerUserId: steamId,
      profile: {
        displayName: profile?.nickname ?? `Steam ${steamId.slice(-4)}`,
        avatarUrl: profile?.avatarUrl ?? null,
      },
    });
  }

  private steamCallbackUrl(state: string): string {
    return `${this.env.PUBLIC_URL}${API_PREFIX}/auth/steam/callback?state=${encodeURIComponent(state)}`;
  }

  // ---------- Google ----------

  @Get('google')
  @OptionalAuth()
  @RateLimit('auth')
  async googleStart(
    @Query('intent') intentRaw: string | undefined,
    @Query('returnTo') returnToRaw: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { intent, returnTo } = this.parseStart(intentRaw, returnToRaw);
    if (!this.google) return this.redirectError(reply, returnTo, 'AUTH_PROVIDER_DISABLED');
    if (intent === 'link' && !req.auth) return this.redirectError(reply, returnTo, 'UNAUTHORIZED');
    const { url, state, codeVerifier } = this.google.start();
    this.tokens.setStateCookie(
      reply,
      await this.tokens.signState({
        p: 'google',
        state,
        codeVerifier,
        intent,
        returnTo,
        linkUserId: req.auth?.userId ?? null,
      }),
    );
    return reply.redirect(url, 302);
  }

  @Get('google/callback')
  @RateLimit('auth')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const st = await this.tokens.verifyState<OAuthState>(req.cookies[COOKIES.oauth]);
    this.tokens.clearStateCookie(reply);
    if (
      !this.google ||
      !st ||
      st.p !== 'google' ||
      st.state !== state ||
      !code ||
      !st.codeVerifier
    ) {
      return this.redirectError(reply, st?.returnTo ?? '/', 'AUTH_FAILED');
    }
    let claims;
    try {
      claims = await this.google.finish(code, st.codeVerifier);
    } catch {
      return this.redirectError(reply, st.returnTo, 'AUTH_FAILED');
    }
    return this.finishRedirect(req, reply, st, {
      provider: 'google',
      providerUserId: claims.sub,
      profile: {
        displayName: claims.name ?? claims.email?.split('@')[0] ?? 'Player',
        avatarUrl: claims.picture ?? null,
        email: claims.email_verified ? (claims.email ?? null) : null,
      },
    });
  }

  // ---------- Telegram ----------

  @Post('telegram')
  @HttpCode(200)
  @OptionalAuth()
  @RateLimit('auth')
  async telegram(
    @ZBody(telegramAuthSchema) body: TelegramAuthPayload,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!isTelegramEnabled(this.env)) throw new AppError('AUTH_PROVIDER_DISABLED', 404);
    const { intent, ...data } = body;
    if (!verifyTelegramAuth(data, this.env.TELEGRAM_BOT_TOKEN as string))
      throw unauthorized('AUTH_FAILED');
    if (intent === 'link' && !req.auth) throw unauthorized();
    const displayName =
      [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username;
    const result = await this.complete(req, reply, {
      provider: 'telegram',
      providerUserId: String(data.id),
      profile: { displayName, avatarUrl: data.photo_url ?? null, username: data.username ?? null },
      intent,
      linkUserId: intent === 'link' ? (req.auth?.userId ?? null) : null,
    });
    return { ok: true, linked: result.linked, created: result.created };
  }

  // ---------- Dev ----------

  /** Вход тестовым пользователем. Только при AUTH_DEV_LOGIN=true и не в production. */
  @Post('dev-login')
  @HttpCode(200)
  @RateLimit('auth')
  async devLogin(
    @ZBody(devLoginSchema) body: DevLoginBody,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!isDevLoginEnabled(this.env)) throw new AppError('AUTH_PROVIDER_DISABLED', 404);
    const preset = DEV_PRESETS[body.preset];
    const nickname = body.nickname ?? preset.nickname;
    const result = await this.complete(req, reply, {
      provider: 'dev',
      providerUserId: body.nickname
        ? `nick:${body.nickname.toLowerCase()}`
        : `preset:${body.preset}`,
      profile: { displayName: nickname, avatarUrl: null },
      intent: 'login',
      forceRole: body.nickname ? undefined : preset.role,
    });
    return { ok: true, created: result.created };
  }

  // ---------- Сессии ----------

  @Post('refresh')
  @HttpCode(200)
  @RateLimit('auth')
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const meta = getRequestMeta(req);
    try {
      const session = await this.sessions.rotate(req.cookies[COOKIES.refresh], meta);
      const info = await this.users.getAuthInfo(session.userId);
      if (!info || info.status === 'banned') {
        await this.sessions.revoke(session.sessionId, 'banned');
        throw unauthorized(info ? 'USER_BANNED' : 'UNAUTHORIZED');
      }
      const access = await this.tokens.signAccess({
        userId: session.userId,
        sessionId: session.sessionId,
        role: info.role,
      });
      this.tokens.setAuthCookies(reply, access, session.refreshToken);
      return { ok: true };
    } catch (err) {
      if (err instanceof AppError && err.code !== 'REFRESH_RACE')
        this.tokens.clearAuthCookies(reply);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const access = req.cookies[COOKIES.access];
    if (access) {
      try {
        const claims = await this.tokens.verifyAccess(access);
        await this.sessions.revoke(claims.sessionId, 'logout');
      } catch {
        // просроченный токен — отзываем по refresh ниже
      }
    }
    const refresh = req.cookies[COOKIES.refresh];
    if (refresh) await this.sessions.revokeByRefreshToken(refresh, 'logout');
    this.tokens.clearAuthCookies(reply);
    return { ok: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  @Auth()
  async logoutAll(
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const revoked = await this.sessions.revokeAllForUser(user.userId, 'logout_all');
    this.tokens.clearAuthCookies(reply);
    return { ok: true, revoked };
  }

  // ---------- общее ----------

  private parseStart(intentRaw: string | undefined, returnToRaw: string | undefined) {
    return {
      intent: (intentRaw === 'link' ? 'link' : 'login') as AuthIntent,
      returnTo: sanitizeReturnTo(returnToRaw, '/'),
    };
  }

  private async complete(req: FastifyRequest, reply: FastifyReply, input: CompleteAuthInput) {
    const meta = getRequestMeta(req);
    const result = await this.auth.completeAuth({
      ...input,
      gameCookie: req.cookies[COOKIES.game],
      referralCookie: req.cookies[COOKIES.referral],
    });
    if (!result.linked) {
      const session = await this.sessions.create(result.userId, meta);
      const access = await this.tokens.signAccess({
        userId: result.userId,
        sessionId: session.sessionId,
        role: result.role,
      });
      this.tokens.setAuthCookies(reply, access, session.refreshToken);
    }
    await this.auth.logAccess(result.userId, result.linked ? 'link' : 'login', meta);
    return result;
  }

  private async finishRedirect(
    req: FastifyRequest,
    reply: FastifyReply,
    st: OAuthState,
    input: Pick<CompleteAuthInput, 'provider' | 'providerUserId' | 'profile'>,
  ) {
    try {
      const result = await this.complete(req, reply, {
        ...input,
        intent: st.intent,
        linkUserId: st.intent === 'link' ? (st.linkUserId ?? null) : null,
      });
      const url = new URL(st.returnTo, this.env.PUBLIC_URL);
      url.searchParams.set(
        result.linked ? 'linked' : 'auth',
        result.linked ? input.provider : 'ok',
      );
      return reply.redirect(url.toString(), 302);
    } catch (err) {
      const code: ErrorCode = err instanceof AppError ? err.code : 'AUTH_FAILED';
      return this.redirectError(reply, st.returnTo, code);
    }
  }

  private redirectError(reply: FastifyReply, returnTo: string, code: ErrorCode) {
    const url = new URL(sanitizeReturnTo(returnTo, '/'), this.env.PUBLIC_URL);
    url.searchParams.set('authError', code);
    return reply.redirect(url.toString(), 302);
  }
}
