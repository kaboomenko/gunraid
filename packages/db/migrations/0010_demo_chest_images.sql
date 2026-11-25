-- Демо-картинки кейсов: новый рисунок (закрытый сундук в стиле макета) по новому адресу.
-- Старый адрес /media/demo/case.svg браузеры кешируют навсегда (immutable), поэтому меняем путь.
-- Затрагиваются только демо-плейсхолдеры; настоящие картинки кейсов не меняются.
UPDATE "cases"
SET "image_url" = replace("image_url", '/media/demo/case.svg', '/media/demo/chest.svg')
WHERE "image_url" LIKE '/media/demo/case.svg%';
