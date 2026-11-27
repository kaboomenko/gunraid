import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { QuestionIcon } from '@/components/icons/design-icons';

const STEPS = ['step1', 'step2', 'step3'] as const;

/**
 * «Как это работает?»: иконка 36 → 24 → заголовок DemiBold 36; через 36 — три пункта Medium 24 (белый
 * 50 %) через 36, номер — в висячем отступе 36. Переносы строк — как в макете (<br> в тексте; уже
 * колонки 480 они прячутся, CSS). На телефоне — иконка и заголовок 16, пункты 12 через 18, колонка по
 * содержимому, переносы как в макете. «Результат можно проверить» — ссылка на проверку текущего раунда.
 */
export function CargoHow({ roundId }: { roundId: string | null }) {
  const t = useTranslations('cargo.how');
  return (
    <div className="cargo-how" data-testid="cargo-how">
      <div className="cargo-how__head">
        <QuestionIcon size={36} className="cargo-how__icon" />
        <h2 className="cargo-how__title">{t('title')}</h2>
      </div>
      <ol className="cargo-how__list" role="list">
        {STEPS.map((k, i) => (
          <li key={k} className="cargo-how__item">
            <span className="cargo-how__num" aria-hidden="true">
              {i + 1}.
            </span>
            <span className="cargo-how__text">
              {t.rich(k, {
                br: () => <br />,
                // Без раунда (груз на паузе) проверять нечего — простой текст.
                verify: (chunks: ReactNode) =>
                  roundId ? (
                    <Link
                      href={`/provably-fair?cargo=${roundId}`}
                      className="cargo-how__link"
                      data-testid="cargo-how-verify"
                    >
                      {chunks}
                    </Link>
                  ) : (
                    chunks
                  ),
              })}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
