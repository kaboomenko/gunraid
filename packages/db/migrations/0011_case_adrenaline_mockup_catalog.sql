CREATE TYPE "public"."adrenaline_level" AS ENUM('low', 'normal', 'high', 'extreme');--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "adrenaline" "adrenaline_level";--> statement-breakpoint
-- Каталог кейсов из макета: прежние демо-кейсы (с демо-картинками) снимаются с витрины —
-- не удаляются, история открытий и проверка честности остаются. Новые кейсы создаёт сид.
UPDATE "cases" SET "is_active" = false, "updated_at" = now()
WHERE "slug" IN ('novobranets', 'lime-rush', 'neon-district', 'raid', 'arsenal', 'klinok', 'nulevoy-tirazh')
  AND "image_url" LIKE '/media/demo/%';--> statement-breakpoint
-- Прежние категории — после новых (новые сид добавит с порядком 1–3).
UPDATE "case_categories" SET "sort_order" = "sort_order" + 100
WHERE "code" IN ('popular', 'premium', 'limited', 'free', 'level') AND "sort_order" < 100;
