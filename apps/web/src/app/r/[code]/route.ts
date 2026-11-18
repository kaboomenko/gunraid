import { COOKIES } from '@gunraid/shared';
import { NextResponse, type NextRequest } from 'next/server';

/** Реферальная ссылка: запоминаем код на 30 дней и отправляем на главную. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const base = process.env.PUBLIC_URL ?? request.nextUrl.origin;
  const res = NextResponse.redirect(new URL('/', base));
  if (/^[A-Za-z0-9]{4,16}$/.test(code)) {
    res.cookies.set(COOKIES.referral, code.toUpperCase(), {
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
      httpOnly: true,
      secure: base.startsWith('https://'),
    });
  }
  return res;
}
