-- Цвета редкостей из дизайн-макета (CS2 и Standoff 2) и новая редкость Standoff 2 «Nameless».
-- На новой базе редкостей ещё нет (их добавят сиды с этими же цветами) — запросы ничего не меняют.
UPDATE "rarities" r SET "color" = v.color
FROM (VALUES
  ('cs2', 'consumer', '#6D8588'),
  ('cs2', 'industrial', '#5FACD2'),
  ('cs2', 'milspec', '#2A68DC'),
  ('cs2', 'restricted', '#742ADC'),
  ('cs2', 'classified', '#DC2AC1'),
  ('cs2', 'covert', '#DC2A2A'),
  ('cs2', 'contraband', '#DCBB2A'),
  ('cs2', 'rare_special', '#DCBB2A'),
  ('standoff2', 'common', '#6D8588'),
  ('standoff2', 'uncommon', '#5FACD2'),
  ('standoff2', 'rare', '#2A68DC'),
  ('standoff2', 'epic', '#742ADC'),
  ('standoff2', 'legendary', '#DC2AC1'),
  ('standoff2', 'arcane', '#DC2A2A')
) AS v(game, code, color), "games" g
WHERE g."code" = v.game AND r."game_id" = g."id" AND r."code" = v.code;
--> statement-breakpoint
UPDATE "rarities" r SET "name" = '{"ru": "Крайне редкий предмет"}'::jsonb
FROM "games" g
WHERE g."code" = 'cs2' AND r."game_id" = g."id" AND r."code" = 'rare_special';
--> statement-breakpoint
INSERT INTO "rarities" ("game_id", "code", "name", "color", "sort_order")
SELECT g."id", 'nameless', '{"ru": "Nameless"}'::jsonb, '#DCBB2A', 7
FROM "games" g
WHERE g."code" = 'standoff2'
  AND EXISTS (SELECT 1 FROM "rarities" r WHERE r."game_id" = g."id")
ON CONFLICT DO NOTHING;
