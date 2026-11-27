'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { splitCountdown } from '@/lib/cargo-page';
import { serverNow } from '@/lib/socket';

/**
 * Серверное время для обратного отсчёта до end (мс). Тик — сразу после того, как до срока остаётся
 * целое число секунд (цифры меняются вовремя, без накопления сдвига, как у setInterval). Первый тик —
 * через setTimeout 0: к этому времени страница уже сверила часы по ответу API (noteServerTime в эффекте
 * родителя). До первого тика — null: и на сервере, и при гидратации отсчёт показывает «--».
 */
function useCountdownClock(end: number | null): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (end === null) return;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = serverNow();
      setNow(t);
      // До следующей смены цифр; +5 мс — чтобы округление вверх уже дало новое значение.
      const rem = (((end - t) % 1000) + 1000) % 1000 || 1000;
      id = setTimeout(tick, rem + 5);
    };
    id = setTimeout(tick, 0);
    return () => clearTimeout(id);
  }, [end]);
  return end === null ? null : now;
}

const UNITS = ['hours', 'minutes', 'seconds'] as const;

/**
 * Таймер «Упадёт через»: три фрейма 96×96, на телефоне 48×48 (часы / минуты / секунды, часы целиком —
 * могут быть больше 24). Отсчёт — по серверному времени. Срока нет (раунд не открыт) — «--». onDone —
 * один раз за срок, когда отсчёт дошёл до нуля (в том числе если страница открыта уже после срока).
 */
export function CargoTimer({ endsAt, onDone }: { endsAt: string | null; onDone?: () => void }) {
  const t = useTranslations('cargo.timer');
  const parsed = endsAt ? Date.parse(endsAt) : NaN;
  const end = Number.isFinite(parsed) ? parsed : null;
  const now = useCountdownClock(end);
  const parts =
    end !== null && now !== null
      ? splitCountdown(end - now)
      : { hours: '--', minutes: '--', seconds: '--' };

  const doneFor = useRef<number | null>(null);
  useEffect(() => {
    if (end === null || now === null || now < end || doneFor.current === end) return;
    doneFor.current = end;
    onDone?.();
  }, [end, now, onDone]);

  return (
    // Метка меняется каждую секунду — не зачитываем (aria-live off), её прочтут при переходе к таймеру.
    <div
      className="cargo-timer"
      role="timer"
      aria-live="off"
      aria-label={t('label', parts)}
      data-testid="cargo-timer"
    >
      {UNITS.map((unit) => (
        <span key={unit} className="cargo-timer__frame" aria-hidden="true">
          <span className="cargo-timer__value" data-testid={`cargo-timer-${unit}`}>
            {parts[unit]}
          </span>
          <span className="cargo-timer__unit">{t(unit)}</span>
        </span>
      ))}
    </div>
  );
}
