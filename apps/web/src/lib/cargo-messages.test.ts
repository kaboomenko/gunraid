import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ru from '../../messages/ru.json';

const t = createTranslator({ locale: 'ru', messages: ru, namespace: 'cargo' });

// Русское `one` в ICU ловит и 21, 31…: где нужна ровно единица — `=1`, где падеж после числа — plural.
describe('тексты грузов: формы чисел', () => {
  it('«Ваше место» — только при одном месте', () => {
    expect(t('mySeats', { count: 1, ranges: '№7', more: 0 })).toBe('Ваше место №7');
    expect(t('mySeats', { count: 21, ranges: '№1–21', more: 0 })).toBe('Ваши места №1–21');
    expect(t('mySeats', { count: 5, ranges: '№1–2, №4, №8–9', more: 2 })).toBe(
      'Ваши места №1–2, №4, №8–9 и ещё 2',
    );
  });

  it('минимум продаж: «от 21 места», «от 3 мест»', () => {
    expect(t('minSeats', { min: 21, kind: 'paid' })).toBe(
      'Розыгрыш состоится, если займут от 21 места, — иначе гемы вернутся',
    );
    expect(t('minSeats', { min: 3, kind: 'paid' })).toBe(
      'Розыгрыш состоится, если займут от 3 мест, — иначе гемы вернутся',
    );
    expect(t('minSeats', { min: 25, kind: 'free' })).toBe(
      'Розыгрыш состоится, если займут от 25 мест',
    );
  });

  it('покупка: единственное число только у одного места', () => {
    // Без раунда цены нет — подпись без «за» и суммы.
    expect(t('buy')).toBe('Купить место');
    expect(t('buyFor', { count: 1 })).toBe('Купить место за');
    expect(t('buyFor', { count: 21 })).toBe('Купить места за');
    expect(t('bought', { count: 21, from: 1, to: 21 })).toBe('Места №1–21 ваши');
    expect(t('limitReached', { count: 21 })).toBe('У вас 21 место — это максимум в раунде');
  });

  it('окно итога: раунд по минимуму продаж — «Розыгрыш не состоялся»', () => {
    expect(t('result.titleMinSeats')).toBe('Розыгрыш не состоялся');
  });
});
