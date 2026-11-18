'use client';

import type { AuthIntent } from '@gunraid/shared';
import { useEffect, useRef } from 'react';
import { useConfig } from '@/lib/config';

declare global {
  interface Window {
    [key: `onTelegramAuth_${string}`]: ((user: Record<string, unknown>) => void) | undefined;
  }
}

/** Кнопка Telegram Login Widget. Работает только на домене, заданном боту в @BotFather (/setdomain). */
export function TelegramWidget({
  intent,
  onAuth,
}: {
  intent: AuthIntent;
  onAuth: (payload: Record<string, unknown>) => void;
}) {
  const config = useConfig();
  const ref = useRef<HTMLDivElement>(null);
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

  useEffect(() => {
    const bot = config.auth.telegram?.botUsername;
    const container = ref.current;
    if (!bot || !container) return;
    const cb = `onTelegramAuth_${intent}` as const;
    window[cb] = (user) => onAuthRef.current({ ...user, intent });
    container.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', bot);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '0');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', `${cb}(user)`);
    container.appendChild(script);
    return () => {
      container.innerHTML = '';
      window[cb] = undefined;
    };
  }, [config.auth.telegram, intent]);

  if (!config.auth.telegram) return null;
  return <div ref={ref} className="flex min-h-10 items-center justify-center" />;
}
