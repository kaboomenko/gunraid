import { DROP_SOURCES, ERROR_CODES, LEDGER_TYPES, NOTIFICATION_TYPES } from '@gunraid/shared';
import { describe, expect, it } from 'vitest';
import ru from '../../messages/ru.json';

/**
 * У каждого значения общих перечислений, которое интерфейс показывает текстом, есть ключ в ru.json:
 * новый тип операции, уведомления, источник дропа или код ошибки без текста показался бы игроку
 * ключом или «Неизвестной ошибкой».
 */
const missing = (values: readonly string[], dict: Record<string, unknown>) =>
  values.filter((v) => !(v in dict));

/**
 * Старые коды админки без текста (интерфейс показывает «Что-то пошло не так»): известный долг, не
 * новые коды. Новые коды в этот список не добавлять — им нужен текст в errors.*.
 */
const ERRORS_WITHOUT_TEXT = ['CSV_INVALID', 'CASE_ODDS_INVALID', 'REASON_REQUIRED'];

describe('i18n coverage of shared enums', () => {
  it('has a history text for every ledger type', () => {
    expect(missing(LEDGER_TYPES, ru.history.types)).toEqual([]);
  });

  it('has a notification text for every notification type', () => {
    expect(missing(NOTIFICATION_TYPES, ru.notifications.types)).toEqual([]);
  });

  it('has a live feed label for every drop source', () => {
    expect(missing(DROP_SOURCES, ru.topBar.sources)).toEqual([]);
  });

  it('has an error text for every error code except the known admin ones', () => {
    expect(missing(ERROR_CODES, ru.errors)).toEqual(ERRORS_WITHOUT_TEXT);
  });
});
