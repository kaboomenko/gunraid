-- Бонус к первому пополнению — 50% (баннер на главной: «+50% к первому пополнению баланса»).
-- Меняем только прежнее значение по умолчанию (10%): если админ уже выставил своё — не трогаем.
UPDATE "settings"
SET "value" = jsonb_set("value", '{percent}', '0.5'::jsonb)
WHERE "key" = 'firstDeposit'
  AND ("value"->>'percent')::numeric = 0.1;
