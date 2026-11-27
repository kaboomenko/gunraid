/**
 * Сугроб промо-полосы на Canvas 2D (вместо картинки), как и падающий снег (lib/snow.ts).
 *
 *   const stop = startSnowDrift(canvas, { measure, watch, onReady, onStale });
 *   stop(); // отменяет отложенную работу, отключает наблюдателей и очищает холст
 *
 * - Холст — полоса внизу промо-полосы высотой DRIFT_LAYOUT.band px узора (46 css px): нарисованное не выше
 *   ~37 px узора, холст в 2,8 раза ниже полосы. На телефоне — DRIFT_PHONE.band (вся картинка эталона, 98 px
 *   узора) в масштабе 0,1795: 17,6 css px при полосе 60, плотность пикселей холста — до 3 (maxDprCompact).
 * - Композиция — из эталона. Силуэт сугроба снят с исходной картинки (макет 10.png) и хранится
 *   ломаными (DRIFT_L / DRIFT_C / DRIFT_R, ~100 узлов, ошибка 0,13–0,21 px). Части привязаны так же,
 *   как стоят текст, кнопка и фон: L (сугроб под фонарём) — к левому краю, C (холм под «…ОКОДУ» и
 *   низина с крышами под кнопкой) — к середине, R (сугроб под куполом) — к правому краю. При ширине
 *   макета (1366) части стоят встык и дают ровно силуэт эталона. Шире — в щели между частями растут
 *   холмы из гнёзд (DRIFT_GAP_*: размер и место — доли щели), уже — части перекрываются (берётся
 *   максимум), а R на узкой полосе отъезжает вправо, чтобы сугроб не лез под кнопку. Тот же силуэт
 *   (и те же тихие зоны) рисует CSS-заглушка .promo-strip::before (snow-drift-css.ts) — до JS и без него.
 * - Телефон (макет 36.png) — эталон целиком, как в макете: края картинки (DRIFT_EDGE_*) у краёв полосы,
 *   части — на своих местах в картинке, без отъезда R; силуэт поднят на DRIFT_PHONE.lift — под сугробами
 *   сплошной слой снега. Телефон движок узнаёт по высоте холста (её задаёт CSS).
 * - С той же картинки сняты (только для холста) волнистость гребня 6–30 px (DRIFT_DETAIL; в щелях —
 *   такой же шум) и передний вал — ближний слой (DRIFT_NEAR_*: низкий вал перед сугробами, в низинах
 *   совпадает с дальним слоем). Объём высоких сугробов — модель, подобранная по той же картинке
 *   (VOLUME: правый склон и тело темнее, левый склон светлее), плюс голубовато-серые пятна.
 * - Тихие зоны — по измерениям: measure() отдаёт прямоугольники строк текста и кнопки; сугроб
 *   опускается (мягко, только где нужно) так, чтобы не подходить к их низу ближе clearance (6 px,
 *   на телефоне 2,5 px). При раскладке макета на десктопе ничего не меняется.
 * - Тело слоя — путь, залитый бесшовной текстурой «крупы»; глубже ~7 px под краем снег темнеет и
 *   синеет (карта затенения, как у фото; на телефоне — не темнее предела, а сплошной слой темнеет к низу
 *   полосы, как в эталоне: DEPTH_PHONE). Край — цепочки пушистых комьев разного размера со случайным
 *   шагом и острые кристаллы поверх; при плотности пикселей ниже 1,5 — едва заметный ореол.
 * - Работа порезана на мелкие шаги (генераторы, до ~0,5 мс): первый кадр и смена масштаба — в простое
 *   кусками до 6 мс, без простоя (занятая страница, медленный ЦП) — по 2 мс, падающий снег не теряет
 *   кадров. Одиночная смена размера при готовых спрайтах и дешёвом кадре — сразу в колбэке
 *   ResizeObserver; иначе (окно тянут, медленный ЦП) холст прячется — видна заглушка — и кадр строится
 *   в простое, когда размер устоится. Если 2D-контекст не создаётся — не больше MAX_TRIES попыток.
 * - Детерминирован: одинаковые сид, размер и прямоугольники дают одинаковые пиксели. Без цикла
 *   кадров: в покое — ни одного вызова. При импорте не обращается к DOM и window.
 */

type Range = readonly [number, number];
type Rgb = readonly [number, number, number];
/** [освещённая сторона, тень]. */
type Tone = readonly [Rgb, Rgb];

// <drift-profile> — сгенерировано tools/genprofile.py и extract*.py из apps/web/public/design/promo-snow-tile.webp (git blob 57281e3a, 44 364 B; удалена вместе с подключением кода); не править руками
/**
 * Силуэт эталона (исходная картинка сугроба 1872×98 — левая половина тайла, видимый верх: альфа > 0,17,
 * сглаживание σ = 5 px, узлы — Дуглас–Пекер с допуском 0,45 px; ошибка 0,13–0,21 px RMS). Пары
 * [x, высота] в px узора, x — от начала части в эталоне, высота — над низом полосы. В макете (полоса
 * 1366) части стоят встык и дают ровно силуэт картинки, из которой видна середина [253, 1619].
 * Внутренние концы частей спускаются к нулю за 12 px (за окном эталона, там их перекрывает соседняя
 * часть) — на любой ширине стыки без ступенек. Картинку можно достать: git cat-file -p 57281e3a > tile.webp.
 * L — картинка [253, 607]: большой сугроб под фонарём и низина до текста; от левого края полосы.
 */
export const DRIFT_L: readonly number[] = [
  0, 9.75, 7, 10.25, 17, 12, 55, 27.25, 64, 29.5, 73, 30.25, 93, 30, 98, 29.25, 108, 27.25, 119,
  23.5, 128, 21.5, 138, 17, 142, 16, 151, 15.75, 162, 14.25, 171, 13.75, 180, 12, 189, 11.5, 199,
  9.25, 225, 8.75, 245, 12, 257, 15, 269, 14.25, 281, 15, 302, 12.25, 333, 4, 354, 0.75, 366, 0,
];
/** C — картинка [607, 1328]: холм под «…ОКОДУ» и низина под кнопкой; левый край — середина полосы − 329. */
export const DRIFT_C: readonly number[] = [
  -12, 0, 0, 0.75, 14, 2.5, 29, 6.25, 48, 8.5, 56, 8.5, 69, 6.5, 81, 9, 85, 9, 100, 6.5, 107, 6.5,
  117, 9, 142, 20.75, 160, 23.25, 177, 22.75, 194, 24.25, 214, 23.25, 244, 25.25, 263, 22, 274,
  18.25, 284, 16.25, 296, 10.25, 300, 9, 306, 9.25, 325, 14.25, 335, 15, 365, 9.5, 377, 6, 384, 5,
  400, 6, 411, 4.75, 417, 5, 424, 6.5, 435, 10.25, 454, 15, 463, 16, 483, 15.25, 500, 7.75, 525,
  2.25, 539, 1.5, 554, 2.25, 568, -0.25, 583, 1, 598, -1.25, 624, 2, 642, 1.5, 655, 0.25, 691, 6.5,
  706, 8, 721, 5.5, 733, 0,
];
/** R — картинка [1328, 1619]: сугроб под куполом и бугор у угла; от правого края полосы. */
export const DRIFT_R: readonly number[] = [
  -12, 0, 0, 5.5, 6, 5.75, 13, 7.75, 28, 14, 48, 24.75, 62, 29.5, 73, 30.5, 100, 28, 127, 33.5, 134,
  34.25, 147, 33.5, 164, 30.75, 191, 19, 205, 17.25, 227, 9.25, 239, 6.75, 246, 7.75, 264, 12.75,
  276, 14.75, 282, 15, 291, 13,
];
/**
 * Гнёзда холмов в щелях между частями (полоса шире макета): [lo, hi, w, c, H, wl, wr, …] — гнездо
 * занимает доли lo…hi щели, форма w×40 px узора — объединение бугров (вершина c, высота H, склоны wl и
 * wr — smoothstep); форма вписана в гнездо (масштаб не больше 1), по центру, низом на низ.
 */
export const DRIFT_GAP_LEFT: readonly (readonly number[])[] = [
  [0, 1, 250, 120, 22, 105, 126, 205, 9, 36, 39],
  [0, 0.5, 230, 110, 15, 96, 114],
  [0.5, 1, 300, 140, 30, 126, 156, 55, 12, 45, 39],
  [0, 0.25, 190, 95, 12, 84, 90],
  [0.25, 0.5, 200, 95, 13, 90, 99],
  [0.75, 1, 200, 105, 17, 96, 90],
];
export const DRIFT_GAP_RIGHT: readonly (readonly number[])[] = [
  [0, 1, 270, 150, 24, 129, 114, 60, 10, 39, 45],
  [0, 0.5, 300, 160, 28, 141, 135, 250, 11, 39, 45],
  [0.5, 1, 220, 100, 15, 90, 114],
  [0, 0.2, 170, 80, 11, 75, 84],
  [0.45, 0.75, 210, 110, 18, 99, 96],
  [0.78, 1, 180, 85, 12, 81, 90],
];
/**
 * Только для холста (не в CSS). Волнистость гребня 6–30 px, которую сглаживание силуэта убрало
 * (видимый верх при σ = 1,5 минус силуэт): по частям L/C/R, отсчёт через 3 px от начала части, цифра
 * d → (d − 7,5) / 4 px. Шире макета щели получают такую же процедурную волнистость.
 */
export const DRIFT_DETAIL = {
  L: '757966677897597798888a68b668a46c9948b886488bd44549b8a744bc95477ca625aa757b9546998854acb69735baa7588a76b947998677777a657',
  C: '758876867b9877889798985348a9c897775578458887788bb867889a77757788a978877766a888658aaa748aa97647c8b9631498767aa86aaa8756a768a9775677758b99655766867c957877ba69848b6bc9576666a978746a776678aaa66557989b97535989866aa8854ab786467879969745dc536cd9666',
  R: '66656978759687799888996ab67789795468877967a99885aa68778ca754a9943679c94a9569568546786879798689e937',
} as const;
/**
 * Только для холста. Передний вал (ближний слой) — спуск его верха под силуэт, ломаные [x, спуск] по
 * частям: снизу вверх светлый снег до затенённого тела дальнего сугроба, минимум по ±40 px (вал перед
 * всем сугробом), σ = 6. Под сугробом под фонарём вал 5–9 px, под куполом — у самого низа.
 */
export const DRIFT_NEAR_L: readonly number[] = [
  0, 10, 15, 11.5, 31, 16.5, 45, 16.5, 67, 24, 94, 24.5, 109, 22, 141, 11, 171, 8.5, 199, 2, 230, 2,
  245, 5.5, 258, 12, 280, 15, 301, 12.5, 333, 4, 354, 0.5,
];
export const DRIFT_NEAR_C: readonly number[] = [
  0, 0.5, 29, 6.5, 41, 7, 53, 6, 68, 2, 84, 4, 106, 1.5, 117, 4, 141, 15, 161, 15, 187, 23.5, 214,
  23, 244, 25, 263, 22, 284, 16, 300, 9, 324, 14, 333, 14.5, 349, 9, 384, 2, 399, 3, 418, 1, 428, 4,
  450, 13.5, 463, 16, 483, 15.5, 500, 8, 525, 2.5, 553, 2.5, 565, 0, 582, 1, 605, 0, 624, 2, 655,
  0.5, 693, 6.5, 708, 6, 721, 3.5,
];
export const DRIFT_NEAR_R: readonly number[] = [
  0, 3.5, 23, 7.5, 44, 17.5, 51, 19, 66, 17, 82, 8.5, 87, 8, 92, 11, 101, 23.5, 106, 28, 133, 34,
  147, 33.5, 164, 30.5, 191, 19, 206, 17, 236, 7, 244, 7.5, 277, 15, 291, 13,
];
// </drift-profile>

/**
 * Раскладка частей (px узора): ref — ширина полосы макета; L занимает [0, left]; левый край C —
 * середина + centre; R занимает [W − right, W] и при W < slide отъезжает вправо на (slide − W) / 2;
 * height — высота окна частей в CSS-заглушке; band — высота холста (полоса внизу, не вся промо-полоса:
 * нарисованное не выше ~37 px, так холст в 2,8 раза меньше).
 */
export const DRIFT_LAYOUT = {
  ref: 1366,
  slide: 1220,
  centre: -329,
  left: 354,
  right: 291,
  height: 40,
  band: 46,
} as const;

/**
 * Телефон (макет 36.png): эталон целиком, ×0,1795 = 336/1872 (на 360 полоса узора Wp = 1872). На десктопе низ
 * полосы срезает нижние 53 px эталона — на телефоне их видно: силуэт поднят на lift (53 − 1,9: низ эталона
 * в макете на 0,34 css ниже полосы). Части стоят как в эталоне: края edge (по 253 px, DRIFT_EDGE_*), L с 253,
 * C от середины, R до Wp − 253, без отъезда R (slide); band — высота холста (вся картинка). Зазор до низа
 * текста и кнопки — SNOW_DRIFT_DEFAULTS.clearanceCompact = 2,5 (в макете снег под кнопкой в 2,6 от её низа).
 */
export const DRIFT_PHONE = { k: 0.1795, band: 98, lift: 51, edge: 253 } as const;
/**
 * Края эталона, которых нет в DRIFT_L / DRIFT_R (картинка x 0…253 и 1619…1872), той же разметкой: [x от начала
 * края, высота − 53], сняты тем же способом (альфа > 0,17, σ = 5, Дуглас–Пекер 0,45; ошибка до 0,41 px).
 * Стыки совпадают: DRIFT_EDGE_L(253) = DRIFT_L(0), DRIFT_EDGE_R(0) = DRIFT_R(291).
 */
export const DRIFT_EDGE_L: readonly number[] = [
  0, 7.75, 11, 8.25, 35, 12.75, 54, 13.25, 64, 14.5, 79, 12, 88, 11, 100, 7, 107, 5.5, 135, 7.25,
  162, 5.25, 175, 6.25, 187, 9, 199, 10.5, 213, 15.75, 219, 16.75, 253, 9.75,
];
export const DRIFT_EDGE_R: readonly number[] = [
  0, 13, 10, 10.5, 15, 10, 36, 12.5, 50, 8.5, 111, 1.25, 116, 2, 130, 6.25, 160, 7.75, 165, 8.75,
  179, 13.5, 194, 14.75, 204, 13.75, 216, 10.75, 226, 9.5, 242, 5.75, 253, 5.5,
];

/** Прямоугольник, к низу которого сугроб не подходит (строка текста, кнопка), css px от левого и верхнего края холста. */
export interface DriftAvoid {
  left: number;
  right: number;
  /** Нижний край, css px от верха холста. */
  bottom: number;
}

export interface SnowDriftOptions {
  /** Сид мелкой детализации (комья, кристаллы, рябь); силуэт задан данными. */
  seed: number;
  /**
   * Масштаб узора; undefined — высота холста / refHeight в пределах [minScale, maxScale], на телефоне
   * (высота холста / refHeight ниже compactScale) — высота холста / DRIFT_PHONE.band.
   */
  scale: number | undefined;
  /** Высота холста при масштабе 1, css px (DRIFT_LAYOUT.band; на телефоне холст — DRIFT_PHONE.band × 0,1795). */
  refHeight: number;
  minScale: number;
  maxScale: number;
  /** Потолок плотности пикселей холста. */
  maxDpr: number;
  /** То же на телефоне (профиль DRIFT_PHONE): холст маленький, а фактура снега мельче пикселя при 2×. */
  maxDprCompact: number;
  /** Ореол снежной пыли над краем при плотности пикселей ниже 1,5. */
  halo: boolean;
  /** Зазор до низа текста и кнопки, css px: широкая полоса / низкая (телефон). */
  clearance: number;
  clearanceCompact: number;
  /** Высота холста / refHeight (или scale) ниже этого — телефон: профиль DRIFT_PHONE. */
  compactScale: number;
  /** Прямоугольники строк текста и кнопки; вызывается перед каждым кадром. */
  measure: (() => readonly DriftAvoid[]) | undefined;
  /** Подписка на события, после которых прямоугольники могли сдвинуться (шрифты, смена текста); возвращает отписку. */
  watch: ((changed: () => void) => () => void) | undefined;
  /** Кадр готов и лежит на холсте (показать холст). */
  onReady: (() => void) | undefined;
  /** Кадр устарел и будет перерисован в простое (спрятать холст — видна CSS-заглушка). */
  onStale: (() => void) | undefined;
}

export const SNOW_DRIFT_DEFAULTS: SnowDriftOptions = {
  seed: 2782,
  scale: undefined,
  refHeight: DRIFT_LAYOUT.band,
  minScale: 0.5,
  maxScale: 1.25,
  maxDpr: 2,
  maxDprCompact: 3,
  halo: true,
  clearance: 6,
  clearanceCompact: 2.5,
  compactScale: 0.85,
  measure: undefined,
  watch: undefined,
  onReady: undefined,
  onStale: undefined,
};

/** Размер кадра для drawSnowDrift: css px и пикселей холста на css px. */
export interface DriftFrame {
  width: number;
  height: number;
  dpr: number;
  avoid: readonly DriftAvoid[];
}

// ---------------------------------------------------------------- оформление (px узора при scale 1)

/** Подложка ближнего слоя: средняя высота и волны [амплитуда, период/2π, фаза]. */
const BAND = {
  base: 3.5,
  waves: [
    [0.75, 37, 1.3],
    [0.45, 13.3, 0.4],
    [0.3, 6.1, 2],
  ],
} as const;
/** Ближний слой: нижняя огибающая силуэта (минимум в ±reach, сглаживание ±smooth дважды) + lift. */
const NEAR = { reach: 40, smooth: 18, lift: 2.2, below: 0.4, low: 9, blend: 4 } as const;
/**
 * Волнистость гребня в щелях (там нет данных эталона): шум решётки с шагом cells px узора и амплитудами
 * amps — RMS около 0,5 px, как у эталона (DRIFT_DETAIL).
 */
const UNDULATE = { cells: [9, 21], amps: [0.75, 0.65] } as const;
/**
 * Видимый край над линией слоя (замерено на живой странице): комья и кристаллы поднимают видимый верх
 * в среднем на drop px узора над линией слоя, ореол (DPR < 1,5) — ещё на haloDrop css px; линия слоя
 * ниже силуэта на столько же, и видимый верх в среднем совпадает с силуэтом эталона. На телефоне спрайты
 * крупнее узора (не мельче 0,5 px экрана на px узора, комья — от 2 px экрана, узор — 0,1795·DPR): комья
 * поднимают видимый верх ещё на compactDrop px экрана (замер при DPR 2 и 3); при ореоле опускание под него
 * и так больше.
 */
const EDGE = { drop: 0.65, haloDrop: 1.45, compactDrop: 1 } as const;
/**
 * Тихие зоны (их же повторяет CSS-заглушка — snow-drift-css.ts): потолок видимой высоты над низом —
 * «низ элемента − зазор − spread» (spread, css px — запас на самые высокие комья: средний видимый верх
 * под потолком на spread ниже, самые высокие комья — на зазор от элемента), ровный над элементом
 * с запасом pad css px по краям (комья цепочки у края потолка не залезают под элемент) и поднимающийся
 * в стороны с крутизной slope; мягкое колено knee (px узора) — до потолка − knee сугроб не меняется.
 * Телефон (замер на живой странице при DPR 1–3): без ореола (DPR от 1,5) комья мельче — spreadCompact
 * (по нему и заглушка телефона: у неё комьев нет), с ореолом комья в 2–3 px экрана и стоят с точностью до
 * пикселя экрана (при DPR 1 — до 0,5 css) — spreadCompactHalo: видимый верх снега (край 50 %) не ближе
 * clearanceCompact к низу кнопки на окнах 280–767 при DPR 1–1,4.
 */
export const DRIFT_CAP = {
  knee: 1.2,
  slope: 0.55,
  pad: 6,
  spread: 1.6,
  spreadCompact: 0.8,
  spreadCompactHalo: 3.2,
} as const;
/** Радиусы комьев края. */
const LUMP_R = [1.7, 2.3, 3, 3.8, 4.7] as const;
/** Вариантов кома; вариантов цепочки на наклон; наклонов (i − 3) / 4 от −0,75 до 0,75. */
const LUMP_VARIANTS = 4;
const CHAIN_VARIANTS = 5;
const SLOPES = 7;
/** Длина цепочки по горизонтали; средний шаг цепочек (каждый — ×0,45…1,65); шагов в ячейке раскладки. */
const CHAIN = 16;
const STEP = 9.5;
const STEP_SPREAD = [0.45, 1.2] as const;
const CHAIN_CELL = 48;
/** Внутренние гребни: глубина от края (от–до), доля мест, непрозрачность. */
const INNER = { depth: [5, 17], share: 0.32, alpha: 0.55 } as const;
/** Кристаллы гребня: средний шаг, выступ над линией (от–до), вариантов. */
const CRYSTAL = { step: 9, share: 0.45, lift: [-0.9, 0.25], alpha: 0.85, variants: 12 } as const;
/** Цвета комьев края: тон 0 — ближний слой, тон 1 — дальний. */
const TONES: readonly Tone[] = [
  [
    [250, 252, 255],
    [219, 229, 245],
  ],
  [
    [244, 248, 253],
    [204, 216, 236],
  ],
];
/** Текстура тела: цвет при яркости 1 и 0 (искры — белые), средняя яркость тайла, затенение впадин. */
const GRAIN: Tone = [
  [253, 254, 255],
  [210, 221, 240],
];
const GRAIN_MEAN = 0.78;
const GRAIN_AO = [1.1, 0.3] as const;
/**
 * Зерно телефона: тайл там мельче пикселя экрана (0,5–0,55 px на px узора) и мелочь сливается — без смягчения
 * и с контрастом ×GRAIN_PHONE (фактура как в макете 36.png).
 */
const GRAIN_PHONE = 2;
/** Тайл текстуры тела, бесшовный по обеим осям (px узора). */
const TILE = [192, 40] as const;
/**
 * Затенение глубины: на глубине d под верхним краем сугроба непрозрачность цвета DEPTH_COLOR
 * ≈ slope·(d − start), не больше max (с ореолом отсчёт на haloShift раньше); гребень ближнего слоя
 * (до crestDepth под своим краем) темнеет на долю crest меньше; пятнистость ±noise (ячейка cell × cell/2).
 */
const DEPTH = {
  start: 7,
  knee: 16,
  tail: 0.55,
  haloShift: 1,
  slope: 0.0195,
  max: 0.62,
  crest: 0.45,
  crestDepth: 8,
  noise: 0.3,
  cell: 12,
} as const;
const DEPTH_COLOR: Rgb = [125, 150, 190];
/**
 * Телефон: видна вся картинка эталона (глубина до ~85 px). В эталоне тело сугробов глубже ~30 px темнее не
 * становится — затенение глубины не больше depth, а сплошной слой внизу темнеет к низу картинки независимо от
 * высоты сугроба над ним — ground·e^(−v/fall), v — px узора над низом полосы; берётся большее (подобрано по
 * эталону и макету 36.png: средний цвет строк 64–71 css совпадает в пределах 3 единиц на канал).
 */
export const DEPTH_PHONE = { depth: 0.19, ground: 0.68, fall: 23 } as const;
/**
 * Объём высоких сугробов (подобрано по картинке-эталону МНК: остаток яркости тела против среднего на той же
 * глубине, RMS 8,1 → 5,5): сугроб выше нижней огибающей на minH…minH + rampH, тело глубже start (за
 * ramp px), наклон силуэта по ±reach px × slopeK (свет слева сверху): правый склон темнее на gain, левый
 * светлее на lit, в целом — на amp. Пятна patch: голубовато-серые ±amp, ячейка cell × cell/2 px.
 */
const VOLUME = {
  minH: 5,
  rampH: 12,
  start: 2,
  ramp: 8,
  amp: -0.057,
  gain: 1.15,
  lit: 0.23,
  slopeK: 1.5,
  reach: 30,
} as const;
const PATCH = { amp: 0.08, cell: 18, start: 3, ramp: 5 } as const;
/** Тексель карты затенения, px узора. */
const MAP_X = 3;
const MAP_Y = 1.5;
/**
 * Ореол над комьями края: ступени [css px от кромки, непрозрачность]; только при DPR < maxPx (по нему же
 * заглушка телефона берёт свою обрезку для холста с ореолом — snow-drift-css.ts).
 */
export const HALO = {
  steps: [
    [1.2, 0.16],
    [0.6, 0.4],
  ],
  maxPx: 1.5,
  color: '240,245,251',
} as const;
/** Выступ комьев над краем слоя (до него карта тени слоя). */
const CREST_LIFT = 2.5;

// ---------------------------------------------------------------- детерминированная случайность

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Хеш трёх целых → uint32. */
function hash3(a: number, b: number, c: number): number {
  return fmix(fmix(fmix(a + 0x9e3779b9) ^ (b + 0x7f4a7c15)) ^ (c + 0x2545f491));
}

/** Последовательность mulberry32. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (range: Range, k: number) => range[0] + (range[1] - range[0]) * k;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

// ---------------------------------------------------------------- силуэт

/** Максимум ломаной nodes (пары [x, h]), сдвинутой на ox, в out по сетке x = x0 + i. */
function polyMax(out: Float32Array, x0: number, nodes: readonly number[], ox: number) {
  const n = nodes.length;
  if (n < 4) return;
  const i0 = Math.max(0, Math.ceil(ox + nodes[0]! - x0));
  const i1 = Math.min(out.length - 1, Math.floor(ox + nodes[n - 2]! - x0));
  let j = 0;
  for (let i = i0; i <= i1; i++) {
    const x = x0 + i - ox;
    while (j < n - 4 && nodes[j + 2]! <= x) j += 2;
    const xa = nodes[j]!;
    const ya = nodes[j + 1]!;
    const v = ya + ((nodes[j + 3]! - ya) * (x - xa)) / (nodes[j + 2]! - xa);
    if (v > out[i]!) out[i] = v;
  }
}

/**
 * Холмы гнёзд щели [gx, gx + g]: форма гнезда вписана в него (масштаб ≤ 1), по центру, низом на низ;
 * бугор — склоны smoothstep (в SVG — кубическая Безье с линейным по t x, то же самое).
 */
function gapMax(
  out: Float32Array,
  x0: number,
  slots: readonly (readonly number[])[],
  gx: number,
  g: number,
) {
  for (const s of slots) {
    const sw = (s[1]! - s[0]!) * g;
    const sc = Math.min(1, sw / s[2]!);
    if (!(sc > 0)) continue;
    const ox = gx + s[0]! * g + (sw - s[2]! * sc) / 2;
    for (let b = 3; b + 3 < s.length; b += 4) {
      const c = ox + s[b]! * sc;
      const H = s[b + 1]! * sc;
      const wl = s[b + 2]! * sc;
      const wr = s[b + 3]! * sc;
      const i0 = Math.max(0, Math.ceil(c - wl - x0));
      const i1 = Math.min(out.length - 1, Math.floor(c + wr - x0));
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i;
        const v = H * smooth(clamp01(x < c ? (x - c + wl) / wl : (c + wr - x) / wr));
        if (v > out[i]!) out[i] = v;
      }
    }
  }
}

/** Части эталона: ломаная силуэта, волнистость гребня и спуск переднего вала (только холст). */
const PARTS = [
  { nodes: DRIFT_L, detail: DRIFT_DETAIL.L, near: DRIFT_NEAR_L },
  { nodes: DRIFT_C, detail: DRIFT_DETAIL.C, near: DRIFT_NEAR_C },
  { nodes: DRIFT_R, detail: DRIFT_DETAIL.R, near: DRIFT_NEAR_R },
] as const;

/**
 * Начала частей L, C, R (px узора от левого края полосы шириной Wp). Телефон — как в эталоне: L после
 * левого края картинки, R до правого, без отъезда.
 */
const partOffsets = (Wp: number, phone: boolean) => {
  const L = DRIFT_LAYOUT;
  if (phone) return [DRIFT_PHONE.edge, Wp / 2 + L.centre, Wp - L.right - DRIFT_PHONE.edge] as const;
  return [0, Wp / 2 + L.centre, Wp - L.right + Math.max(0, (L.slide - Wp) / 2)] as const;
};

/**
 * Силуэт (видимый верх, px узора над низом полосы; на телефоне — без подъёма DRIFT_PHONE.lift) на сетке
 * x = x0 + i для полосы шириной Wp px узора. Телефон: ещё края эталона у краёв полосы; щели — между частями
 * и краями (на 360 их нет, шире растут холмы гнёзд).
 */
export function driftSilhouette(out: Float32Array, x0: number, Wp: number, phone = false): void {
  const L = DRIFT_LAYOUT;
  out.fill(-99);
  const offs = partOffsets(Wp, phone);
  PARTS.forEach((p, i) => polyMax(out, x0, p.nodes, offs[i]!));
  const e = phone ? DRIFT_PHONE.edge : 0;
  if (phone) {
    polyMax(out, x0, DRIFT_EDGE_L, 0);
    polyMax(out, x0, DRIFT_EDGE_R, Wp - e);
  }
  const g = Wp / 2 - L.ref / 2 - e;
  if (g > 0) {
    gapMax(out, x0, DRIFT_GAP_LEFT, L.left + e, g);
    gapMax(out, x0, DRIFT_GAP_RIGHT, Wp - L.right - e - g, g);
  }
}

/** Значение ломаной nodes (пары [x, y]) в x; левее первого и правее последнего узла — out. */
function lineAt(nodes: readonly number[], x: number, out: number): number {
  const n = nodes.length;
  if (n < 4 || !(x >= nodes[0]! && x <= nodes[n - 2]!)) return out;
  let lo = 0;
  let hi = n / 2 - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid * 2]! <= x) lo = mid;
    else hi = mid;
  }
  const xa = nodes[lo * 2]!;
  const ya = nodes[lo * 2 + 1]!;
  const xb = nodes[hi * 2]!;
  return xb > xa ? ya + ((nodes[hi * 2 + 1]! - ya) * (x - xa)) / (xb - xa) : ya;
}

/** Волнистость гребня части (DRIFT_DETAIL): отсчёт через 3 px, цифра d → (d − 7,5) / 4 px; вне — 0. */
function detailAt(code: string, x: number): number {
  const f = x / 3;
  const i = Math.floor(f);
  if (i < 0 || i >= code.length - 1) return 0;
  const a = parseInt(code[i]!, 16) - 7.5;
  const b = parseInt(code[i + 1]!, 16) - 7.5;
  return (a + (b - a) * (f - i)) / 4;
}

/** Процедурная волнистость гребня (щели без данных эталона): шум решётки, детерминирован по месту u. */
function undulate(seed: number, u: number): number {
  let v = 0;
  for (let j = 0; j < UNDULATE.cells.length; j++) {
    const f = u / UNDULATE.cells[j]!;
    const i = Math.floor(f);
    const a = hash3(seed ^ 0x3d1, j, i) / 2147483648 - 1;
    const b = hash3(seed ^ 0x3d1, j, i + 1) / 2147483648 - 1;
    v += UNDULATE.amps[j]! * (a + (b - a) * smooth(f - i));
  }
  return v;
}

const bandAt = (u: number) => {
  const w = BAND.waves;
  return (
    BAND.base +
    w[0][0] * Math.sin(u / w[0][1] + w[0][2]) +
    w[1][0] * Math.sin(u / w[1][1] + w[1][2]) +
    w[2][0] * Math.sin(u / w[2][1] + w[2][2])
  );
};

/** Скользящий минимум радиуса r (van Herk / Gil–Werman), края — повтор крайнего значения. */
function runMin(src: Float32Array, out: Float32Array, r: number) {
  const n = src.length;
  const w = 2 * r + 1;
  const m = n + 2 * r;
  const ext = new Float32Array(m);
  for (let i = 0; i < m; i++) ext[i] = src[i < r ? 0 : i - r >= n ? n - 1 : i - r]!;
  const pre = new Float32Array(m);
  const suf = new Float32Array(m);
  for (let i = 0; i < m; i++) pre[i] = i % w === 0 ? ext[i]! : Math.min(pre[i - 1]!, ext[i]!);
  for (let i = m - 1; i >= 0; i--)
    suf[i] = i === m - 1 || (i + 1) % w === 0 ? ext[i]! : Math.min(suf[i + 1]!, ext[i]!);
  for (let i = 0; i < n; i++) out[i] = Math.min(suf[i]!, pre[i + 2 * r]!);
}

/** Скользящее среднее радиуса r (края — повтор крайнего значения). */
function boxMean(src: Float32Array, out: Float32Array, r: number) {
  const n = src.length;
  const last = n - 1;
  let acc = 0;
  for (let i = -r; i <= r; i++) acc += src[i < 0 ? 0 : i > last ? last : i]!;
  for (let i = 0; i < n; i++) {
    out[i] = acc / (2 * r + 1);
    const a = i + r + 1;
    const b = i - r;
    acc += src[a > last ? last : a]! - src[b < 0 ? 0 : b]!;
  }
}

/** Мягкий потолок: до cap − knee без изменений, дальше плавно (C¹) к cap. */
const softCap = (v: number, cap: number) => {
  const t = cap - DRIFT_CAP.knee;
  return v <= t ? v : t + DRIFT_CAP.knee * (1 - Math.exp(-(v - t) / DRIFT_CAP.knee));
};

// ---------------------------------------------------------------- попиксельные заготовки

/** Добавляет бугор (параболоид², высота hgt, радиус r) в карту высот z (S×T); wrap — по кругу. */
function bump(
  z: Float32Array,
  S: number,
  T: number,
  bx: number,
  by: number,
  r: number,
  hgt: number,
  wrap: boolean,
) {
  const ib = 1 / (r * r);
  const reach = wrap ? 1 : 0;
  for (let ox = -reach; ox <= reach; ox++) {
    for (let oy = -reach; oy <= reach; oy++) {
      const cx = bx + ox * S;
      const cy = by + oy * T;
      const x0 = Math.max(0, Math.floor(cx - r));
      const x1 = Math.min(S - 1, Math.floor(cx + r));
      const y1 = Math.min(T - 1, Math.floor(cy + r));
      for (let y = Math.max(0, Math.floor(cy - r)); y <= y1; y++) {
        const dy = y + 0.5 - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          const q = 1 - (dx * dx + dy * dy) * ib;
          if (q > 0) z[y * S + x] = z[y * S + x]! + hgt * q * q;
        }
      }
    }
  }
}

/**
 * Яркость карты высот при свете сверху-спереди (0, −0,6, 0,8): base + span·(n·L) и лёгкий шум;
 * доля spark хорошо освещённых пикселей становится искрой (2 — белый). Края — по кругу.
 */
function* light(
  z: Float32Array,
  S: number,
  T: number,
  gain: number,
  base: number,
  span: number,
  spark: number,
  seed: number,
): Work<Float32Array> {
  const out = new Float32Array(S * T);
  for (let y = 0; y < T; y++) {
    if (y && (y * S) % ROWS_PX < S) yield;
    const up = y > 0 ? -S : S * (T - 1);
    const dn = y < T - 1 ? S : -S * (T - 1);
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const nx = (z[x > 0 ? i - 1 : i + S - 1]! - z[x < S - 1 ? i + 1 : i - S + 1]!) * gain;
      const ny = (z[i + up]! - z[i + dn]!) * gain;
      const d = Math.max(0, (0.8 - 0.6 * ny) / Math.sqrt(nx * nx + ny * ny + 1));
      let h = Math.imul(i ^ seed, 0x9e3779b1);
      h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
      h ^= h >>> 13;
      out[i] =
        d > 0.7 && h >>> 0 < spark * 4294967296
          ? 2
          : Math.min(1, base + span * d + ((h & 1023) / 1023 - 0.5) * 0.08);
    }
  }
  return out;
}

/** Пикселей за шаг в попиксельных циклах (около 0,1 мс без замедления). */
const ROWS_PX = 500;

/** Пиксель k: цвет между тенью и светом по b ∈ [0, 1]; b > 1 — подмешивание белого (искра). */
function paint(D: Uint8ClampedArray, k: number, b: number, tone: Tone, a: number) {
  const [lit, sh] = tone;
  const m = Math.min(1, b);
  const w = Math.min(1, b - 1);
  const r = sh[0] + (lit[0] - sh[0]) * m;
  const g = sh[1] + (lit[1] - sh[1]) * m;
  const bl = sh[2] + (lit[2] - sh[2]) * m;
  D[k] = w > 0 ? r + (255 - r) * w : r;
  D[k + 1] = w > 0 ? g + (255 - g) * w : g;
  D[k + 2] = w > 0 ? bl + (255 - bl) * w : bl;
  D[k + 3] = a;
}

function canvasOf(
  doc: Document,
  w: number,
  h: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  try {
    const cv = doc.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    return g ? [cv, g] : null;
  } catch {
    return null;
  }
}

/** Скользящее среднее радиуса r по строкам (horizontal) или столбцам, по кругу (тайл бесшовный). */
function* boxBlur(
  src: Float32Array,
  S: number,
  T: number,
  r: number,
  horizontal: boolean,
): Work<Float32Array> {
  const out = new Float32Array(S * T);
  const len = horizontal ? S : T;
  const lines = horizontal ? T : S;
  const step = horizontal ? 1 : S;
  const k = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    if (l && (l * len) % ROWS_PX < len) yield;
    const base = horizontal ? l * S : l;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[base + (((i % len) + len) % len) * step]!;
    for (let i = 0; i < len; i++) {
      out[base + i * step] = acc * k;
      acc +=
        src[base + ((i + r + 1) % len) * step]! -
        src[base + ((((i - r) % len) + len) % len) * step]!;
    }
  }
  return out;
}

// ---------------------------------------------------------------- спрайты (кеш на плотность пикселей)

interface LumpSheet {
  canvas: HTMLCanvasElement;
  /** Сторона ячейки, px экрана. */
  size: number;
  /** Радиус кома, px экрана. */
  R: number;
}

interface Atlas {
  canvas: HTMLCanvasElement;
  /** Ячейка атласа, px экрана; точка привязки — в её центре. */
  cw: number;
  ch: number;
  /** Комья каждого столбца (для ореола): [x, y, R, …] — центр в ячейке и радиус, px экрана. */
  lumps: Float32Array[];
}

interface Sprites {
  doc: Document;
  /** Пикселей экрана на px узора (с шагом 0,05). */
  s: number;
  /** Зерно телефона (GRAIN_PHONE). */
  phone: boolean;
  grain: HTMLCanvasElement;
  chains: Atlas;
  crystals: Atlas;
  /** Черновик для карт затенения. */
  scratch: [HTMLCanvasElement, CanvasRenderingContext2D];
}

/** Шаг работы: генератор отдаёт управление после каждого куска в ~1 мс. */
type Work<T> = Generator<void, T, void>;

/**
 * Комья радиуса R (px экрана): LUMP_VARIANTS столбцов × TONES строк ячеек S×S. Купол + мелкие бугорки,
 * большинство по верхней кромке (пушистые зубчики, у части — острые); мягкая голубоватая кромка; искры.
 */
function* buildLumps(doc: Document, R: number): Work<LumpSheet | null> {
  const S = 2 * (R + Math.ceil(R * 0.35) + 1);
  const c = S / 2;
  const made = canvasOf(doc, S * LUMP_VARIANTS, S * TONES.length);
  if (!made) return null;
  const [cv, g] = made;
  const img = g.createImageData(cv.width, cv.height);
  const z = new Float32Array(S * S);
  const feather = (2 * Math.max(1.2, R * 0.5)) / R; // у кромки z ≈ 2(1 − ρ)
  for (let v = 0; v < LUMP_VARIANTS; v++) {
    const rand = rng(hash3(0x5eed, R, v));
    // форма купола: чуть сплюснута и наклонена по-разному
    const sx = 0.88 + 0.24 * rand();
    const sy = 0.82 + 0.26 * rand();
    for (let i = 0; i < S * S; i++) {
      const x = ((i % S) + 0.5 - c) / (R * sx);
      const y = (((i / S) | 0) + 0.5 - c) / (R * sy);
      z[i] = Math.max(0, 1 - x * x - y * y);
    }
    for (let b = 8 + ((rand() * 7) | 0); b > 0; b--) {
      const rim = rand() < 0.62;
      const a = rim ? -Math.PI * (0.05 + 0.9 * rand()) : Math.PI * 2 * rand();
      const d = (rim ? 0.78 + 0.25 * rand() : 0.65 * Math.sqrt(rand())) * R;
      const r = (rim && rand() < 0.35 ? 0.1 + 0.1 * rand() : 0.17 + 0.2 * rand()) * R;
      bump(
        z,
        S,
        S,
        c + Math.cos(a) * d,
        c + Math.sin(a) * d,
        Math.max(0.6, r),
        0.08 + 0.16 * rand(),
        false,
      );
    }
    const lum = finish(light(z, S, S, R * 0.4, 0.42, 0.66, 0.04, hash3(0xa11, R, v)));
    yield;
    TONES.forEach((tone, t) => {
      for (let i = 0; i < S * S; i++) {
        const zi = z[i]!;
        if (zi <= 0) continue;
        let a = Math.min(1, zi / feather);
        a *= a * (3 - 2 * a);
        const l = lum[i]!;
        // пушистая кромка чуть темнее (полупрозрачный снег на фоне ночного неба)
        const b = l > 1 ? l : l * (0.8 + 0.2 * a);
        const k = ((t * S + ((i / S) | 0)) * cv.width + v * S + (i % S)) * 4;
        paint(img.data, k, b, tone, a * 255);
      }
    });
    yield;
  }
  g.putImageData(img, 0, 0);
  return { canvas: cv, size: S, R };
}

/**
 * Цепочки: короткие ряды комьев разного размера вдоль прямой наклона (i − 3) / 4, нижние поверх
 * верхних; шаг и высота комьев неровные (гребень без ритма). Атлас: SLOPES × CHAIN_VARIANTS
 * столбцов × TONES строк ячеек cw×ch; точка края — в центре ячейки.
 */
function* buildChains(doc: Document, s: number): Work<Atlas | null> {
  const sheets = new Map<number, LumpSheet | null>();
  const maxR = LUMP_R[LUMP_R.length - 1]!;
  const cw = Math.ceil((CHAIN + 2 * maxR + 4) * s);
  const ch = Math.ceil((CHAIN * 0.75 + 2 * maxR + 4) * s);
  const made = canvasOf(doc, cw * SLOPES * CHAIN_VARIANTS, ch * TONES.length);
  if (!made) return null;
  const [cv, g] = made;
  yield;
  const lumps: Float32Array[] = [];
  for (let si = 0; si < SLOPES; si++) {
    const sl = (si - 3) / 4;
    for (let v = 0; v < CHAIN_VARIANTS; v++) {
      const rand = rng(hash3(0xc4a1, si, v));
      const list: { x: number; y: number; sheet: LumpSheet; variant: number }[] = [];
      for (
        let x = -CHAIN / 2 + 2 * rand();
        x <= CHAIN / 2;
        x += 1.7 + 3.1 * rand() * rand() + 0.6 * rand()
      ) {
        // размеры с перекосом к мелким, редкие крупные
        const ri = Math.min(LUMP_R.length - 1, Math.floor(rand() ** 1.6 * LUMP_R.length));
        const r = LUMP_R[ri]! * (0.85 + 0.3 * rand());
        const y = sl * x - r * (0.55 + 0.45 * rand());
        const R = Math.max(2, Math.round(r * s));
        let sheet = sheets.get(R);
        if (sheet === undefined) {
          sheet = yield* buildLumps(doc, R);
          sheets.set(R, sheet);
        }
        if (sheet) list.push({ x, y, sheet, variant: (rand() * LUMP_VARIANTS) | 0 });
      }
      list.sort((a, b) => b.y - a.y);
      const col = si * CHAIN_VARIANTS + v;
      const meta = new Float32Array(list.length * 3);
      list.forEach((L, m) => {
        const S = L.sheet.size;
        const dx = Math.round((col + 0.5) * cw + L.x * s - S / 2);
        const dy = Math.round(0.5 * ch - L.y * s - S / 2);
        for (let t = 0; t < TONES.length; t++)
          g.drawImage(L.sheet.canvas, L.variant * S, t * S, S, S, dx, dy + t * ch, S, S);
        meta[m * 3] = dx - col * cw + S / 2;
        meta[m * 3 + 1] = dy + S / 2;
        meta[m * 3 + 2] = L.sheet.R;
      });
      lumps.push(meta);
      yield;
    }
  }
  return { canvas: cv, cw, ch, lumps };
}

/**
 * Кристаллы гребня: острые светлые осколки (сужающийся отрезок длиной 1,4–3,6 px узора, наклон
 * до ±40°, свет слева сверху — левая грань ярче) и мелкие сверкающие зёрна. Точка привязки —
 * основание осколка в центре ячейки; строки — тона.
 */
function* buildCrystals(doc: Document, s: number): Work<Atlas | null> {
  const n = CRYSTAL.variants;
  const cw = Math.ceil(9 * s) | 1;
  const ch = Math.ceil(9 * s) | 1;
  const made = canvasOf(doc, cw * n, ch * TONES.length);
  if (!made) return null;
  const [cv, g] = made;
  const img = g.createImageData(cv.width, cv.height);
  const D = img.data;
  for (let v = 0; v < n; v++) {
    const rand = rng(hash3(0xc275, v, 77));
    const grainy = v % 4 === 3;
    const ang = (rand() - 0.5) * (grainy ? 0 : 1.1);
    const len = (grainy ? 0.7 : 0.8 + 1.3 * rand()) * s;
    const wid = (grainy ? 0.7 + 0.5 * rand() : 0.55 + 0.45 * rand()) * s;
    const bx = (cw - 1) / 2 + 0.5;
    const by = ch / 2 + 0.5;
    const tx = bx + Math.sin(ang) * len;
    const ty = by - Math.cos(ang) * len;
    const ex = tx - bx;
    const ey = ty - by;
    const ee = ex * ex + ey * ey || 1;
    TONES.forEach((tone, t) => {
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const px = x + 0.5 - bx;
          const py = y + 0.5 - by;
          const q = clamp01((px * ex + py * ey) / ee);
          const dx = px - ex * q;
          const dy = py - ey * q;
          const dist = Math.sqrt(dx * dx + dy * dy);
          // на 2× осколок не тоньше 1 css px (иначе — игла в пиксель экрана)
          const r = Math.max(grainy ? wid : wid * (1 - 0.85 * q) + 0.25, s >= 1.5 ? 0.5 * s : 0);
          const a = clamp01(r + 0.5 - dist);
          if (a <= 0) continue;
          // левая/верхняя грань ярче, кончик — искра
          const side = (dx * Math.cos(ang) + dy * Math.sin(ang)) / (r + 0.5);
          const b = 0.7 + 0.3 * clamp01(0.5 - side) + (grainy ? 0.25 : 0.08 * q);
          paint(D, ((t * ch + y) * cv.width + v * cw + x) * 4, b, tone, a * 255);
        }
      }
    });
    yield;
  }
  g.putImageData(img, 0, 0);
  return { canvas: cv, cw, ch, lumps: [] };
}

/**
 * Бесшовный тайл текстуры тела: мягкие крупные комья (объём), неравномерные по плотности и размеру
 * комочки 1–3 px (свет сверху, тень снизу), мелкая крупа, искры. Средняя яркость (без искр) приводится
 * к GRAIN_MEAN — текстура не меняет средний цвет, его задают тона и затенение глубины. Телефон — GRAIN_PHONE.
 */
function* buildGrain(doc: Document, s: number, phone: boolean): Work<HTMLCanvasElement | null> {
  const tw = Math.round(TILE[0] * s);
  const th = Math.round(TILE[1] * s);
  const n = tw * th;
  const z = new Float32Array(n);
  const glint = new Float32Array(n);
  const rand = rng(hash3(0x9a1, Math.round(s * 20), 7));
  const area = TILE[0] * TILE[1];
  // плотность мелочи меняется по тайлу: несколько пятен (гуще/реже), по кругу
  const spots: number[] = [];
  for (let i = 0; i < 7; i++)
    spots.push(rand() * tw, rand() * th, (14 + 22 * rand()) * s, rand() < 0.5 ? 1 : -1);
  const density = (x: number, y: number) => {
    let d = 0;
    for (let i = 0; i < spots.length; i += 4) {
      let dx = Math.abs(x - spots[i]!);
      let dy = Math.abs(y - spots[i + 1]!);
      dx = Math.min(dx, tw - dx);
      dy = Math.min(dy, th - dy);
      const r = spots[i + 2]!;
      d += spots[i + 3]! * Math.exp(-(dx * dx + dy * dy) / (r * r));
    }
    return clamp01(0.55 + 0.45 * d);
  };
  const at = () => [rand() * tw, rand() * th] as const;
  // мягкие волны
  for (let i = 0; i < area / 240; i++) {
    const [x, y] = at();
    bump(z, tw, th, x, y, (6 + 8 * rand()) * s, 0.5 + 0.5 * rand(), true);
    yield;
  }
  yield;
  // комья 2–6 px (структура «цветной капусты», как у фото): светлый верх, тень снизу и в щелях
  let placed = 0;
  for (let i = 0; i < area / 20; i++) {
    const [x, y] = at();
    if (rand() > 0.35 + 0.65 * density(x, y)) continue;
    bump(z, tw, th, x, y, (2.1 + 3.6 * rand() ** 1.5) * s, 0.55 + 0.6 * rand(), true);
    if (++placed % 10 === 0) yield;
  }
  yield;
  // мелкие комочки — гуще в «пятнах»
  for (let i = 0; i < area / 16; i++) {
    const [x, y] = at();
    if (rand() > density(x, y)) continue;
    bump(z, tw, th, x, y, (0.9 + 1.1 * rand() ** 2) * s, 0.25 + 0.35 * rand(), true);
    if (++placed % 50 === 0) yield;
  }
  yield;
  for (let i = 0; i < area / 12; i++) {
    const [x, y] = at();
    bump(z, tw, th, x, y, (0.5 + 0.4 * rand()) * s, 0.03 + 0.06 * rand(), true);
    if (i % 100 === 99) yield;
  }
  for (let i = 0; i < area / 40; i++) {
    const [x, y] = at();
    if (rand() > 0.35 + 0.65 * density(x, y)) continue;
    // на 2× — мягкая круглая точка (не «плюс» 3×3)
    bump(
      glint,
      tw,
      th,
      x,
      y,
      s >= 1.5 ? 1.05 * s : Math.max(0.75, 0.6 * s),
      0.55 + 0.45 * rand(),
      true,
    );
  }
  yield;
  const lum = yield* light(z, tw, th, s * 1.05, 0.45, 0.62, 0, hash3(0xb22, Math.round(s * 20), 3));
  yield;
  // впадины между комочками темнее: насколько точка ниже среднего по окрестности ~2 px
  const r1 = Math.max(1, Math.round(1.6 * s));
  const avgRows = yield* boxBlur(z, tw, th, r1, true);
  yield;
  const avg = yield* boxBlur(avgRows, tw, th, r1, false);
  yield;
  for (let i = 0; i < n; i++) {
    lum[i] = lum[i]! - Math.min(GRAIN_AO[1], Math.max(0, avg[i]! - z[i]!) * GRAIN_AO[0]);
    if (i % (ROWS_PX * 2) === ROWS_PX * 2 - 1) yield;
  }
  yield;
  // на 1× фото мягче: лёгкое размытие яркости (искры остаются чёткими); на телефоне зерно и так мельче пикселя
  if (s < 1.5 && !phone) {
    const softRows = yield* boxBlur(lum, tw, th, 1, true);
    yield;
    const soft = yield* boxBlur(softRows, tw, th, 1, false);
    for (let i = 0; i < n; i++) lum[i] = 0.55 * lum[i]! + 0.45 * soft[i]!;
    yield;
  }
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (glint[i]! > 0) continue;
    sum += lum[i]!;
    cnt++;
  }
  const mean = sum / Math.max(1, cnt);
  const shift = GRAIN_MEAN - mean;
  yield;
  const made = canvasOf(doc, tw, th);
  if (!made) return null;
  const [cv, g] = made;
  const img = g.createImageData(tw, th);
  yield;
  for (let i = 0; i < n; i++) {
    if (i && i % ROWS_PX === 0) yield;
    const gl = glint[i]!;
    // искра — плавно к белому от яркости зерна (без ступеньки по краю)
    const v = phone ? GRAIN_MEAN + (lum[i]! - mean) * GRAIN_PHONE : lum[i]! + shift;
    const base = Math.max(0, Math.min(1, v));
    const b = gl > 0 ? base + (2 - base) * Math.min(1, gl) : base;
    paint(img.data, i * 4, b, GRAIN, 255);
  }
  yield;
  g.putImageData(img, 0, 0);
  return cv;
}

/** Кеш спрайтов: до двух плотностей (десктоп и телефон — переход через 768 px без пересборки). */
const cache: Sprites[] = [];
/** Запущенных startSnowDrift: когда остановлен последний, кеш отпускается. */
let running = 0;

/** Пикселей экрана на px узора, с шагом 0,05 (ключ кеша спрайтов). */
const spriteScale = (k: number, px: number) => Math.max(0.5, Math.round(k * px * 20) / 20);

function cached(doc: Document, s: number, phone: boolean): Sprites | null {
  return cache.find((c) => c.doc === doc && c.s === s && c.phone === phone) ?? null;
}

function* buildSprites(doc: Document, s: number, phone: boolean): Work<Sprites | null> {
  const hit = cached(doc, s, phone);
  if (hit) return hit;
  const grain = yield* buildGrain(doc, s, phone);
  if (!grain) return null;
  const chains = yield* buildChains(doc, s);
  if (!chains) return null;
  const crystals = yield* buildCrystals(doc, s);
  const scratch = canvasOf(doc, 64, 16);
  if (!crystals || !scratch) return null;
  const sp: Sprites = { doc, s, phone, grain, chains, crystals, scratch };
  cache.unshift(sp);
  if (cache.length > 2) cache.length = 2;
  return sp;
}

// ---------------------------------------------------------------- кадр

export interface Geometry {
  /** css px холста. */
  W: number;
  H: number;
  /** Пиксели холста. */
  bw: number;
  bh: number;
  /** Масштаб узора, пикселей холста на css px. */
  k: number;
  px: number;
  py: number;
  /** Ширина полосы, px узора. */
  Wp: number;
  /** Сетка u = u0 + i (px узора от середины полосы), u0 кратно 6 — одно место рисуется одинаково. */
  u0: number;
  len: number;
  /** Телефон: профиль DRIFT_PHONE (эталон целиком, подъём, зазор clearanceCompact). */
  phone: boolean;
}

/** Телефон (профиль DRIFT_PHONE): масштаб — заданный или высота холста / refHeight — ниже compactScale. */
const compactOf = (H: number, o: SnowDriftOptions) => (o.scale ?? H / o.refHeight) < o.compactScale;

/**
 * Масштаб и сетка кадра. Телефон узнаётся по высоте холста: CSS задаёт 98·k (при k 0,1795 — 17,6 css px)
 * против 46 на десктопе; там масштаб — высота холста / DRIFT_PHONE.band.
 */
export function geometry(
  W: number,
  H: number,
  bw: number,
  bh: number,
  o: SnowDriftOptions,
): Geometry {
  const wide = H / o.refHeight;
  const phone = compactOf(H, o);
  const k =
    o.scale ?? (phone ? H / DRIFT_PHONE.band : Math.min(o.maxScale, Math.max(o.minScale, wide)));
  const Wp = W / k;
  const u0 = Math.floor((-Wp / 2 - 24) / 6) * 6;
  return { W, H, bw, bh, k, px: bw / W, py: bh / H, Wp, u0, len: Math.ceil(Wp + 48) + 14, phone };
}

interface Fields {
  /** Линии края дальнего и ближнего слоя (px узора над низом). */
  far: Float32Array;
  near: Float32Array;
  /** Верх сугроба (для глубины). */
  top: Float32Array;
  /** Гладкий силуэт (без волнистости и потолков) и его высота над нижней огибающей — для объёма. */
  sil: Float32Array;
  prom: Float32Array;
}

/**
 * Силуэт → края слоёв. Дальний — силуэт эталона с волнистостью гребня (части — данные картинки, щели —
 * шум). Ближний — передний вал: у частей — снятый с картинки (DRIFT_NEAR_*), в щелях — нижняя огибающая
 * силуэта; в низинах (силуэт ниже NEAR.low) совпадает с дальним — один гребень; не ниже подложки.
 * Потолки тихих зон (измеренные прямоугольники) — мягко, по видимой высоте (с комьями). Телефон: края
 * эталона — как щели (волнистость — шум, вал — нижняя огибающая); края слоёв и верх подняты на
 * DRIFT_PHONE.lift, потолки считаются для неподнятого силуэта; sil и prom — без подъёма (нужны разности).
 */
function* fieldsFor(
  geo: Geometry,
  avoid: readonly DriftAvoid[],
  clearance: number,
  halo: boolean,
  seed: number,
): Work<Fields> {
  const { len, u0, Wp, k, H, phone } = geo;
  const lift = phone ? DRIFT_PHONE.lift : 0;
  const x0 = u0 + Wp / 2;
  const sil = new Float32Array(len);
  driftSilhouette(sil, x0, Wp, phone);
  yield;
  // какая часть даёт силуэт в столбце (иначе — холм щели, край эталона или ничего) и x от её начала
  const which = new Int8Array(len).fill(-1);
  const rel = new Float32Array(len);
  const offs = partOffsets(Wp, phone);
  for (let pi = 0; pi < PARTS.length; pi++) {
    const nodes = PARTS[pi]!.nodes;
    const ox = offs[pi]!;
    const end = nodes[nodes.length - 2]!;
    for (let i = Math.max(0, Math.ceil(ox + nodes[0]! - x0)); i < len && x0 + i - ox <= end; i++) {
      const x = x0 + i - ox;
      if (lineAt(nodes, x, -99) >= sil[i]! - 1e-3) {
        which[i] = pi;
        rel[i] = x;
      }
    }
    yield;
  }
  // волнистость (сглажена ±2 px: без ступенек на границах часть/щель) и передний вал частей
  const wave = new Float32Array(len);
  const front = new Float32Array(len).fill(NaN);
  for (let i = 0; i < len; i++) {
    const p = which[i]!;
    const part = p >= 0 ? PARTS[p] : undefined;
    if (part) {
      wave[i] = detailAt(part.detail, rel[i]!);
      front[i] = sil[i]! - lineAt(part.near, rel[i]!, 0);
    } else wave[i] = undulate(seed, u0 + i);
  }
  const waveS = new Float32Array(len);
  boxMean(wave, waveS, 2);
  yield;
  const env = new Float32Array(len);
  const tmp = new Float32Array(len);
  runMin(sil, tmp, NEAR.reach);
  yield;
  boxMean(tmp, env, NEAR.smooth);
  boxMean(env, tmp, NEAR.smooth);
  yield;
  const caps = new Float32Array(len).fill(Infinity);
  // запас на самые высокие комья (DRIFT_CAP): на телефоне свой — от размера комьев на экране
  const spread = !phone
    ? DRIFT_CAP.spread
    : halo
      ? DRIFT_CAP.spreadCompactHalo
      : DRIFT_CAP.spreadCompact;
  for (const r of avoid) {
    const floor = (H - r.bottom - clearance - spread) / k - lift;
    if (!(floor < 60)) continue;
    const a = (r.left - DRIFT_CAP.pad) / k - Wp / 2;
    const b = (r.right + DRIFT_CAP.pad) / k - Wp / 2;
    for (let i = 0; i < len; i++) {
      const u = u0 + i;
      const d = u < a ? a - u : u > b ? u - b : 0;
      const cap = floor + DRIFT_CAP.slope * d;
      if (cap < caps[i]!) caps[i] = cap;
    }
  }
  yield;
  const far = new Float32Array(len);
  const near = new Float32Array(len);
  const top = new Float32Array(len);
  const prom = new Float32Array(len);
  // на телефоне комья крупнее узора (EDGE.compactDrop, px экрана); ореол опускает край и так сильнее
  const drop =
    EDGE.drop + Math.max(halo ? EDGE.haloDrop / k : 0, phone ? EDGE.compactDrop / (k * geo.px) : 0);
  for (let i = 0; i < len; i++) {
    const s0 = sil[i]!;
    const s = s0 + waveS[i]!;
    const fr = Number.isNaN(front[i]!) ? tmp[i]! + NEAR.lift : front[i]! + waveS[i]!;
    const low = smooth(clamp01((s0 - NEAR.low) / NEAR.blend));
    const nv = Math.max(s - NEAR.below - low * Math.max(0, s - NEAR.below - fr), bandAt(u0 + i));
    const cap = caps[i]!;
    const f = (cap === Infinity ? s : softCap(s, cap)) - drop;
    const nn = (cap === Infinity ? nv : softCap(nv, cap)) - drop;
    far[i] = f + lift;
    near[i] = nn + lift;
    top[i] = Math.max(f, nn) + lift;
    prom[i] = s0 - tmp[i]!;
  }
  return { far, near, top, sil, prom };
}

/**
 * Места цепочек края на [u0, u1): процесс восстановления — каждый шаг ×(STEP_SPREAD) от STEP, без
 * ритма; ось делится на длинные ячейки (CHAIN_CELL шагов), первая цепочка ячейки — на случайном
 * отступе, стык со следующей делится, если длинный: раскладка зависит только от места.
 * Тройки [u, вариант, сдвиг по высоте].
 */
function chainLayout(seed: number, li: number, u0: number, u1: number): number[] {
  const span = STEP * CHAIN_CELL;
  const [g0, g1] = STEP_SPREAD;
  const first = (j: number) =>
    j * span + STEP * (g0 + (g1 * hash3(seed ^ 0x51ab, li + 1, j)) / 4294967296);
  const out: number[] = [];
  const push = (u: number, rand: () => number) => {
    const variant = (rand() * CHAIN_VARIANTS) | 0;
    const jitter = (rand() - 0.5) * (1 + rand());
    if (u >= u0 && u < u1) out.push(u, variant, jitter);
  };
  for (let j = Math.floor(u0 / span) - 1; j * span < u1; j++) {
    const rand = rng(hash3(seed ^ 0x1234, li + 1, j));
    const next = first(j + 1);
    let u = first(j);
    for (;;) {
      push(u, rand);
      const g = STEP * (g0 + g1 * rand());
      if (u + g < next - g0 * STEP) {
        u += g;
        continue;
      }
      if (next - u > (g0 + g1) * STEP) push((u + next) / 2, rand);
      break;
    }
  }
  return out;
}

/** Пикселей холста за шаг растровой операции (очистка, заливка тела, затенение): до ~0,3 мс. */
const RASTER_PX = 24000;

/**
 * Растровая операция по столбцам холста [x0, x1) кусками ~RASTER_PX пикселей, по шагу на кусок;
 * paint(a, b) рисует столбцы [a, b) (через clipTo — ровно те же пиксели, что одной операцией).
 */
function* columns(
  x0: number,
  x1: number,
  bh: number,
  paint: (a: number, b: number) => void,
): Work<void> {
  const w = Math.max(64, Math.floor(RASTER_PX / Math.max(1, bh)));
  for (let a = Math.max(0, Math.floor(x0)); a < x1; a += w) {
    paint(a, Math.min(Math.ceil(x1), a + w));
    yield;
  }
}

/** Рисует draw() только в столбцах [a, b) холста высотой bh. */
function clipTo(ctx: CanvasRenderingContext2D, a: number, b: number, bh: number, draw: () => void) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(a, 0, b - a, bh);
  ctx.clip();
  draw();
  ctx.restore();
}

/**
 * Затенение глубины и объёма слоя поверх уже нарисованного (source-atop) — карта MAP_X × MAP_Y; на телефоне —
 * с пределом глубины и затенением низа (DEPTH_PHONE).
 */
function* shadeDepth(
  ctx: CanvasRenderingContext2D,
  sp: Sprites,
  f: Fields,
  own: Float32Array,
  cover: Float32Array,
  geo: Geometry,
  seed: number,
  li: number,
  X: (u: number) => number,
  Y: (v: number) => number,
  start: number,
) {
  const { u0, len } = geo;
  const top = f.top;
  const nc = Math.floor((len - 1) / MAP_X);
  const tops = new Float32Array(nc);
  const edges = new Float32Array(nc);
  const vols = new Float32Array(nc);
  const sides = new Float32Array(nc);
  let i0 = -1;
  let i1 = -1;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i < nc; i++) {
    const x = i * MAP_X + 1;
    const t = (top[x]! + top[x + 1]!) / 2;
    const e = (own[x]! + own[x + 1]!) / 2;
    const hidden = Math.max(-3, (cover[x]! + cover[x + 1]!) / 2 - 5);
    const vis = Math.min(t - start, e + CREST_LIFT);
    tops[i] = t;
    edges[i] = e;
    if (li === 0) {
      // объём: насколько сугроб выше нижней огибающей; наклон гладкого силуэта по ±reach px
      vols[i] = smooth(clamp01((f.prom[x]! - VOLUME.minH) / VOLUME.rampH));
      const a = Math.max(0, x - VOLUME.reach);
      const b = Math.min(len - 1, x + VOLUME.reach);
      const rise = Math.max(0, f.sil[b]!) - Math.max(0, f.sil[a]!);
      sides[i] = Math.max(-1, Math.min(1, (-rise / (b - a)) * VOLUME.slopeK));
    }
    if (vis <= hidden) continue;
    if (i0 < 0) i0 = i;
    i1 = i;
    hi = Math.max(hi, vis);
    lo = Math.min(lo, hidden);
  }
  if (i0 < 0) return;
  yield;
  const vTop = Math.ceil(hi / MAP_Y) * MAP_Y;
  const vBot = Math.floor(lo / MAP_Y) * MAP_Y;
  const rows = Math.round((vTop - vBot) / MAP_Y);
  const cols = i1 - i0 + 1;
  // карта + защитный столбец (прозрачный) и строка (копия последней): drawImage с участком
  // источника сглаживает и по соседним пикселям черновика — там не должно остаться прошлой карты
  const [cv, g] = sp.scratch;
  if (cv.width < cols + 1 || cv.height < rows + 1) {
    cv.width = Math.max(cv.width, cols + 1);
    cv.height = Math.max(cv.height, rows + 1);
  }
  const iw = cols + 1;
  const img = g.createImageData(iw, rows + 1);
  const D = img.data;
  const nx = DEPTH.cell;
  const ny = DEPTH.cell / 2;
  const gx0 = Math.floor((u0 + i0 * MAP_X) / nx);
  const gy0 = Math.floor(vBot / ny);
  const gw = Math.ceil((u0 + (i1 + 1) * MAP_X) / nx) - gx0 + 2;
  const gh = Math.ceil(vTop / ny) - gy0 + 2;
  const lattice = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++)
      lattice[y * gw + x] = hash3(seed ^ 0xd5e9, (li + 1) * 65536 + y + gy0, x + gx0) / 4294967296;
  }
  // пятна: вторая решётка, крупнее (PATCH.cell × PATCH.cell/2)
  const px2 = PATCH.cell;
  const py2 = PATCH.cell / 2;
  const hx0 = Math.floor((u0 + i0 * MAP_X) / px2);
  const hy0 = Math.floor(vBot / py2);
  const hw = Math.ceil((u0 + (i1 + 1) * MAP_X) / px2) - hx0 + 2;
  const hh = Math.ceil(vTop / py2) - hy0 + 2;
  const patches = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++)
      patches[y * hw + x] =
        (2 * hash3(seed ^ 0x9a7c, (li + 1) * 65536 + y + hy0, x + hx0)) / 4294967296 - 1;
  }
  const [cr, cg, cb] = DEPTH_COLOR;
  for (let r = 0; r < rows; r++) {
    if (r && (r * cols) % (ROWS_PX * 2) < cols) yield;
    const v = vTop - (r + 0.5) * MAP_Y;
    const fy = v / ny - gy0;
    const yi = Math.min(gh - 2, Math.max(0, Math.floor(fy)));
    const ty = smooth(clamp01(fy - yi));
    const ground = geo.phone ? DEPTH_PHONE.ground * Math.exp(-v / DEPTH_PHONE.fall) : 0;
    const hy = v / py2 - hy0;
    const hyi = Math.min(hh - 2, Math.max(0, Math.floor(hy)));
    const hty = smooth(clamp01(hy - hyi));
    for (let c = 0; c < cols; c++) {
      const i = c + i0;
      const dOwn = edges[i]! - v;
      const d = tops[i]! - v;
      // глубина (у гребня слабее — он светлее) + объём и пятна (тени склонов доходят до самого гребня)
      const deep =
        (Math.min(d, DEPTH.knee) - start + DEPTH.tail * Math.max(0, d - DEPTH.knee)) * DEPTH.slope;
      let a = deep * (1 - DEPTH.crest * (1 - smooth(clamp01(dOwn / DEPTH.crestDepth))));
      if (dOwn < -CREST_LIFT) continue;
      if (li === 0 && vols[i]! > 0) {
        const body = smooth(clamp01((d - VOLUME.start) / VOLUME.ramp));
        const side = sides[i]!;
        a +=
          vols[i]! *
          body *
          (VOLUME.amp + VOLUME.gain * Math.max(0, side) - VOLUME.lit * Math.max(0, -side));
      }
      const u = u0 + (i + 0.5) * MAP_X;
      {
        const hx = u / px2 - hx0;
        const hxi = Math.min(hw - 2, Math.max(0, Math.floor(hx)));
        const htx = smooth(clamp01(hx - hxi));
        const q2 = hyi * hw + hxi;
        const m0 = patches[q2]! + (patches[q2 + 1]! - patches[q2]!) * htx;
        const m1 = patches[q2 + hw]! + (patches[q2 + hw + 1]! - patches[q2 + hw]!) * htx;
        a += PATCH.amp * (m0 + (m1 - m0) * hty) * smooth(clamp01((d - PATCH.start) / PATCH.ramp));
      }
      if (geo.phone) a = Math.max(Math.min(a, DEPTH_PHONE.depth), ground);
      if (a <= 0) continue;
      const fx = u / nx - gx0;
      const xi = Math.min(gw - 2, Math.max(0, Math.floor(fx)));
      const tx = smooth(fx - xi);
      const q = yi * gw + xi;
      const n0 = lattice[q]! + (lattice[q + 1]! - lattice[q]!) * tx;
      const n1 = lattice[q + gw]! + (lattice[q + gw + 1]! - lattice[q + gw]!) * tx;
      const noise = 1 + DEPTH.noise * 2 * (n0 + (n1 - n0) * ty - 0.5);
      const k = (r * iw + c) * 4;
      D[k] = cr;
      D[k + 1] = cg;
      D[k + 2] = cb;
      D[k + 3] = 255 * Math.min(DEPTH.max, a) * noise;
    }
  }
  D.copyWithin(rows * iw * 4, (rows - 1) * iw * 4, rows * iw * 4);
  g.putImageData(img, 0, 0);
  yield;
  const x0 = X(u0 + i0 * MAP_X);
  const y0 = Y(vTop);
  const dw = X(u0 + (i1 + 1) * MAP_X) - x0;
  const dh = Y(vBot) - y0;
  yield* columns(x0, x0 + dw, geo.bh, (a, b) =>
    clipTo(ctx, a, b, geo.bh, () => {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cv, 0, 0, cols, rows, x0, y0, dw, dh);
    }),
  );
}

/**
 * Ореол снежной пыли, одна ступень: огибающая комьев края, раздутых на width css px, залитая
 * полупрозрачным белым (alpha) одной заливкой. Рисуется до тела слоя: внутри огибающей её закрывают
 * тело и комья, остаётся кайма над краем.
 */
function haloFill(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  placed: readonly number[],
  env: Float32Array,
  px: number,
  bh: number,
  width: number,
  alpha: number,
) {
  const bw = env.length;
  const hw = width * px;
  env.fill(Infinity);
  for (let p = 0; p < placed.length; p += 3) {
    const meta = atlas.lumps[placed[p]!];
    if (!meta) continue;
    const ox = placed[p + 1]!;
    const oy = placed[p + 2]!;
    for (let m = 0; m < meta.length; m += 3) {
      const cx = ox + meta[m]!;
      const cy = oy + meta[m + 1]!;
      const R = meta[m + 2]! + hw;
      const xe = Math.min(bw - 1, Math.floor(cx + R - 0.5));
      for (let x = Math.max(0, Math.ceil(cx - R - 0.5)); x <= xe; x++) {
        const dx = x + 0.5 - cx;
        const t = cy - Math.sqrt(Math.max(0, R * R - dx * dx));
        if (t < env[x]!) env[x] = t;
      }
    }
  }
  ctx.beginPath();
  let open = false;
  for (let x = 0; x <= bw; x++) {
    const y = x < bw ? env[x]! : Infinity;
    if (y < bh) {
      if (!open) {
        ctx.moveTo(x, bh);
        ctx.lineTo(x, y);
        open = true;
      }
      ctx.lineTo(x + 0.5, y);
    } else if (open) {
      ctx.lineTo(x, env[x - 1]!);
      ctx.lineTo(x, bh);
      ctx.closePath();
      open = false;
    }
  }
  ctx.fillStyle = `rgba(${HALO.color},${alpha})`;
  ctx.fill();
}

/** drawImage за раз между уступками управления (на плотности пикселей от 1,5 — меньше: ячейки крупнее). */
const BATCH = 40;
const BATCH_DENSE = 16;

/**
 * Кадр по кускам: очистка, поля, затем по слоям (дальний → ближний) ореол, тело, внутренние гребни,
 * цепочки края, кристаллы, затенение. Холст до конца кадра скрыт (виден по onReady). Крупные растровые
 * операции (очистка, заливка тела, затенение) — по столбцам, кусками ~RASTER_PX пикселей.
 */
function* drawFrame(
  ctx: CanvasRenderingContext2D,
  geo: Geometry,
  o: SnowDriftOptions,
  avoid: readonly DriftAvoid[],
  sp: Sprites,
): Work<boolean> {
  const { W, H, bw, bh, k, px, py, u0, len } = geo;
  // пороги по высоте края (комья, гребни, кристаллы) — для неподнятого силуэта
  const lift = geo.phone ? DRIFT_PHONE.lift : 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  yield* columns(0, bw, bh, (a, b) => ctx.clearRect(a, 0, b - a, bh));
  const seed = o.seed >>> 0;
  const haloOn = o.halo && px < HALO.maxPx;
  const f = yield* fieldsFor(
    geo,
    avoid,
    geo.phone ? o.clearanceCompact : o.clearance,
    haloOn,
    seed,
  );
  yield;
  const at = (h: Float32Array, u: number) => {
    const x = Math.min(len - 1.001, Math.max(0, u - u0));
    const i = x | 0;
    return h[i]! + (h[i + 1]! - h[i]!) * (x - i);
  };
  const X = (u: number) => (W / 2 + u * k) * px;
  const Y = (v: number) => (H - v * k) * py;
  const { chains, crystals, grain } = sp;
  const pattern = ctx.createPattern(grain, 'repeat');
  const inset = LUMP_R[1];
  const halo = haloOn ? new Float32Array(bw) : null;
  const shadeStart = DEPTH.start - (halo ? DEPTH.haloShift : 0);
  const none = new Float32Array(len).fill(-9);
  const layers = [
    { h: f.far, cover: f.near, tone: 1 as const },
    { h: f.near, cover: none, tone: 0 as const },
  ];
  const slopeAt = (h: Float32Array, u: number) =>
    (at(h, u + CHAIN / 2) - at(h, u - CHAIN / 2)) / CHAIN;
  const slopeCol = (h: Float32Array, u: number) =>
    Math.min(SLOPES - 1, Math.max(0, Math.round(slopeAt(h, u) * 4) + 3));
  const batch = sp.s >= 1.5 ? BATCH_DENSE : BATCH;

  for (let li = 0; li < layers.length; li++) {
    const { h, cover, tone } = layers[li]!;
    // ---- раскладка: край (где слой виден и не совпадает с ближним), внутренние гребни, кристаллы
    const edge: number[] = [];
    const lay = chainLayout(seed, li, u0 + CHAIN, u0 + len - CHAIN);
    for (let j = 0; j < lay.length; j += 3) {
      const u = lay[j]!;
      const v = at(h, u);
      const c = at(cover, u);
      if (v - lift < -1 || v < c - 2.5 || (li === 0 && v < c + 1.2)) continue;
      edge.push(
        slopeCol(h, u) * CHAIN_VARIANTS + lay[j + 1]!,
        Math.round(X(u) - chains.cw / 2),
        Math.round(Y(v + 0.45 * lay[j + 2]!) - chains.ch / 2),
      );
    }
    yield;
    const inner: number[] = [];
    if (li === 0) {
      for (let j = Math.floor(u0 / STEP) + 1; (j + 1) * STEP < u0 + len; j++) {
        const rand = rng(hash3(seed ^ 0x7e57, li + 1, j));
        const u = (j + rand()) * STEP;
        const v = at(h, u) - lerp(INNER.depth, rand());
        if (rand() > INNER.share || v - lift < 3 || v < at(cover, u)) continue;
        inner.push(
          slopeCol(h, u) * CHAIN_VARIANTS + ((rand() * CHAIN_VARIANTS) | 0),
          Math.round(X(u) - chains.cw / 2),
          Math.round(Y(v + 0.3 * (rand() - 0.5)) - chains.ch / 2),
        );
      }
    }
    yield;
    const shards: number[] = [];
    {
      const cs = CRYSTAL.step;
      for (let j = Math.floor(u0 / cs) + 1; (j + 1) * cs < u0 + len; j++) {
        const rand = rng(hash3(seed ^ 0xc275, li + 1, j));
        const u = (j + rand()) * cs;
        const v = at(h, u);
        const c = at(cover, u);
        if (rand() > CRYSTAL.share || v - lift < 0 || v < c - 1.5 || (li === 0 && v < c + 1.2))
          continue;
        shards.push(
          (rand() * CRYSTAL.variants) | 0,
          Math.round(X(u) - crystals.cw / 2),
          Math.round(Y(v + lerp(CRYSTAL.lift, rand())) - crystals.ch / 2),
        );
      }
    }
    yield;
    // ---- ореол над краем (до тела: внутри огибающей его закроют тело и комья)
    if (halo) {
      for (const [width, alpha] of HALO.steps) {
        haloFill(ctx, chains, edge, halo, px, bh, width, alpha);
        yield;
      }
    }
    // ---- тело: один путь чуть ниже края (его закрывают цепочки) до места, где слой закрыт ближним
    const body = new Path2D();
    for (let x = 0; x < len; x += 6) body.lineTo(X(x + u0), Y(h[x]! - inset * 0.9));
    for (let x = len - 1 - ((len - 1) % 6); x >= 0; x -= 6) {
      body.lineTo(X(x + u0), Y(Math.max(-2, Math.min(h[x]! - inset, cover[x]! - 5))));
    }
    pattern?.setTransform(
      new DOMMatrix([1, 0, 0, 1, Math.round(X(li * 83)), Math.round(Y(li * 13))]),
    );
    ctx.fillStyle = pattern ?? `rgb(${GRAIN[0].join()})`;
    yield* columns(0, bw, bh, (a, b) => clipTo(ctx, a, b, bh, () => ctx.fill(body)));
    // ---- внутренние гребни, край, кристаллы
    const { cw, ch } = chains;
    ctx.globalAlpha = INNER.alpha;
    for (let j = 0; j < inner.length; j += 3) {
      ctx.drawImage(
        chains.canvas,
        inner[j]! * cw,
        tone * ch,
        cw,
        ch,
        inner[j + 1]!,
        inner[j + 2]!,
        cw,
        ch,
      );
      if ((j / 3) % batch === batch - 1) yield;
    }
    ctx.globalAlpha = 1;
    yield;
    for (let j = 0; j < edge.length; j += 3) {
      ctx.drawImage(
        chains.canvas,
        edge[j]! * cw,
        tone * ch,
        cw,
        ch,
        edge[j + 1]!,
        edge[j + 2]!,
        cw,
        ch,
      );
      if ((j / 3) % batch === batch - 1) yield;
    }
    yield;
    const { cw: kw, ch: kh } = crystals;
    ctx.globalAlpha = CRYSTAL.alpha;
    for (let j = 0; j < shards.length; j += 3) {
      ctx.drawImage(
        crystals.canvas,
        shards[j]! * kw,
        tone * kh,
        kw,
        kh,
        shards[j + 1]!,
        shards[j + 2]!,
        kw,
        kh,
      );
      if ((j / 3) % batch === batch - 1) yield;
    }
    ctx.globalAlpha = 1;
    yield;
    // ---- затенение глубины и объёма (темнит и комья внутри высоких сугробов)
    yield* shadeDepth(ctx, sp, f, h, cover, geo, seed, li, X, Y, shadeStart);
  }
  return true;
}

/** Выполняет работу до конца (синхронно). */
function finish<T>(work: Work<T>): T {
  for (;;) {
    const r = work.next();
    if (r.done) return r.value;
  }
}

/**
 * Рисует сугроб на холст, размер которого (canvas.width/height) уже задан в пикселях экрана, целиком
 * и синхронно (для тестов и скриншотов; на странице — startSnowDrift).
 * @returns false — рисовать нечего (нулевой размер или нет 2D-контекста).
 */
export function drawSnowDrift(
  canvas: HTMLCanvasElement,
  options?: Partial<SnowDriftOptions & DriftFrame>,
): boolean {
  const o: SnowDriftOptions = { ...SNOW_DRIFT_DEFAULTS, ...options };
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return false;
  const dpr = options?.dpr ?? 1;
  const W = options?.width ?? canvas.width / dpr;
  const H = options?.height ?? canvas.height / dpr;
  if (!(W > 0 && H > 0 && canvas.width > 0 && canvas.height > 0)) return false;
  const geo = geometry(W, H, canvas.width, canvas.height, o);
  const sp = finish(buildSprites(canvas.ownerDocument, spriteScale(geo.k, geo.px), geo.phone));
  if (!sp) return false;
  return finish(drawFrame(ctx, geo, o, options?.avoid ?? o.measure?.() ?? [], sp));
}

// ---------------------------------------------------------------- запуск

/**
 * Кусок работы в простое, мс: SLICE_MS, но не больше оставшегося простоя; если простоя так и не было
 * (таймаут — страница занята, например ЦП медленный) — FORCED_MS, хотя бы один шаг: кадр анимации важнее
 * (шаги до ~0,5 мс; при замедлении ЦП ×4 кусок без простоя — до ~5 мс). Простоя ждём не дольше
 * IDLE_TIMEOUT мс для первого куска и IDLE_NEXT мс для следующих; без requestIdleCallback — пауза
 * IDLE_FALLBACK мс между кусками.
 */
const SLICE_MS = 6;
const FORCED_MS = 2;
const IDLE_TIMEOUT = 500;
const IDLE_NEXT = 50;
const IDLE_FALLBACK = 24;
/** Попыток собрать спрайты (если 2D-контекст не создаётся); дальше остаётся CSS-заглушка. */
const MAX_TRIES = 3;
/**
 * Смена размера при готовых спрайтах перерисовывается сразу, в колбэке ResizeObserver (без устаревшего
 * кадра), если прошлый кадр стоил не больше SYNC_MAX_MS работы и прошлое изменение было раньше BURST_MS
 * назад. Иначе (медленный ЦП, окно тянут) холст прячется — видна заглушка с тем же силуэтом — и кадр
 * строится в простое, когда размер не менялся SETTLE_MS.
 */
const SYNC_MAX_MS = 6;
const BURST_MS = 250;
const SETTLE_MS = 150;

const avoidKey = (list: readonly DriftAvoid[]) =>
  list
    .map((r) => `${Math.round(r.left * 2)},${Math.round(r.right * 2)},${Math.round(r.bottom * 2)}`)
    .join(';');

/**
 * Держит сугроб нарисованным на холсте, размер которого задан стилями (полоса внизу промо-полосы:
 * position:absolute; bottom:0; width:100%; height — DRIFT_LAYOUT.band css px в масштабе узора, на телефоне —
 * DRIFT_PHONE.band: по высоте холста движок выбирает профиль и потолок плотности пикселей). Первый
 * кадр и смена масштаба — в простое кусками (холст скрыт, видна заглушка); одиночная смена размера при
 * готовых спрайтах и смена прямоугольников — сразу, если кадр дешёвый. Возвращает остановку.
 */
export function startSnowDrift(
  canvas: HTMLCanvasElement,
  options?: Partial<SnowDriftOptions>,
): () => void {
  const o: SnowDriftOptions = { ...SNOW_DRIFT_DEFAULTS, ...options };
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = win ? canvas.getContext('2d') : null;
  } catch {
    ctx = null;
  }
  if (!win || !ctx) return () => undefined;
  const g = ctx;
  const w = win;
  running++;

  let W = 0; // css px — последний размер от наблюдателя
  let H = 0;
  let bw = 0; // пиксели холста
  let bh = 0;
  let avoid: readonly DriftAvoid[] = [];
  let drawn = ''; // что сейчас на холсте (размер + прямоугольники)
  let ready = false;
  let stopped = false;
  let tries = 0;
  let job: Work<boolean> | null = null;
  let jobKey = '';
  let idle = 0;
  let settle = 0; // таймер «размер устоялся»
  let slices = 0;
  let lastChange = -Infinity;
  let frameCost = Infinity; // работа последнего кадра без сборки спрайтов, мс
  let framing = false; // идёт сам кадр — его шаги складываются в frameWork
  let frameWork = 0;
  const idleApi = typeof w.requestIdleCallback === 'function';
  const now = () => w.performance.now();

  const measure = () => {
    try {
      avoid = o.measure?.() ?? [];
    } catch {
      avoid = [];
    }
  };
  const keyNow = () => `${W}x${H}/${bw}x${bh}/${avoidKey(avoid)}`;
  const valid = () => W > 0 && H > 0 && bw > 0 && bh > 0;

  function cancelIdle() {
    if (!idle) return;
    if (idleApi) w.cancelIdleCallback(idle);
    else w.clearTimeout(idle);
    idle = 0;
  }

  function cancelSettle() {
    if (!settle) return;
    w.clearTimeout(settle);
    settle = 0;
  }

  function later() {
    if (idle || stopped || !job) return;
    const timeout = slices++ ? IDLE_NEXT : IDLE_TIMEOUT;
    idle = idleApi ? w.requestIdleCallback(step, { timeout }) : w.setTimeout(step, IDLE_FALLBACK);
  }

  function sizeBacking() {
    if (canvas.width !== bw) canvas.width = bw; // смена размера очищает холст
    if (canvas.height !== bh) canvas.height = bh;
  }

  function shown() {
    if (ready) return;
    ready = true;
    o.onReady?.();
  }

  function hidden() {
    if (!ready) return;
    ready = false;
    o.onStale?.();
  }

  /** Полная работа: размер холста (он уже скрыт), спрайты (если их нет в кеше) и кадр. */
  function* fullJob(geo: Geometry, list: readonly DriftAvoid[]): Work<boolean> {
    sizeBacking();
    yield;
    const sp = yield* buildSprites(doc, spriteScale(geo.k, geo.px), geo.phone);
    if (!sp) return false;
    yield;
    framing = true;
    frameWork = 0;
    return yield* drawFrame(g, geo, o, list, sp);
  }

  function startJob() {
    settle = 0;
    if (stopped) return;
    job = fullJob(geometry(W, H, bw, bh, o), avoid);
    framing = false;
    slices = 0;
    later();
  }

  function done(ok: boolean, cost: number) {
    job = null;
    framing = false;
    if (ok) {
      drawn = jobKey;
      frameCost = cost;
      shown();
      return;
    }
    // 2D-контекст для спрайтов не создался: ещё несколько попыток, потом остаётся заглушка
    if (++tries < MAX_TRIES) startJob();
  }

  /**
   * Кусок работы: шаги, пока следующий (оценка — самый долгий из прошлых шагов куска) укладывается
   * в бюджет; хотя бы один шаг.
   */
  function step(deadline?: IdleDeadline) {
    idle = 0;
    if (stopped || !job) return;
    const t0 = now();
    const budget = !deadline
      ? SLICE_MS
      : deadline.didTimeout
        ? FORCED_MS
        : Math.min(SLICE_MS, deadline.timeRemaining());
    let t = t0;
    let worst = 0;
    for (;;) {
      const r = job.next();
      const t1 = now();
      if (framing) frameWork += t1 - t;
      if (r.done) {
        done(r.value, frameWork);
        return;
      }
      worst = Math.max(worst, t1 - t);
      t = t1;
      if (t - t0 + worst >= budget) break;
    }
    later();
  }

  /** Что-то изменилось (размер, DPR, прямоугольники): перерисовать сразу или в простое. */
  function update() {
    if (stopped || !valid() || tries >= MAX_TRIES) return;
    measure();
    const key = keyNow();
    if (key === drawn && !job && !settle) return;
    if ((job || settle) && key === jobKey) return;
    if (key === drawn && !job && canvas.width === bw && canvas.height === bh) {
      // размер вернулся к нарисованному, пока ждали: кадр на холсте верный
      cancelSettle();
      shown();
      return;
    }
    const t = now();
    const burst = t - lastChange < BURST_MS;
    lastChange = t;
    const geo = geometry(W, H, bw, bh, o);
    const sp = cached(doc, spriteScale(geo.k, geo.px), geo.phone);
    cancelIdle();
    cancelSettle();
    job = null;
    framing = false;
    jobKey = key;
    if (sp && ready && !burst && frameCost <= SYNC_MAX_MS) {
      // одиночное изменение и дешёвый кадр: сразу, в том же кадре (колбэки ResizeObserver — до отрисовки)
      sizeBacking();
      const t0 = now();
      const ok = finish(drawFrame(g, geo, o, avoid, sp));
      done(ok, now() - t0);
      return;
    }
    // первый кадр, новый масштаб, медленный ЦП или окно тянут: холст прячем (видна заглушка с тем же
    // силуэтом, без растянутого старого кадра), кадр — в простое кусками, при частых изменениях — когда
    // размер устоится
    hidden();
    if (burst && sp) settle = w.setTimeout(startJob, SETTLE_MS);
    else startJob();
  }

  function resize(cssW: number, cssH: number, devW: number, devH: number) {
    const ratio = w.devicePixelRatio || 1;
    // телефон (по высоте холста, как в geometry) — свой потолок плотности
    const cap = compactOf(cssH, o) ? o.maxDprCompact : o.maxDpr;
    const dpr = Math.min(ratio, cap);
    let nextBw = Math.round(cssW * dpr);
    let nextBh = Math.round(cssH * dpr);
    // точный размер в пикселях экрана (1:1), если он согласуется с DPR
    if (
      ratio <= cap &&
      devW > 0 &&
      devH > 0 &&
      Math.abs(devW - cssW * ratio) < 1.5 &&
      Math.abs(devH - cssH * ratio) < 1.5
    ) {
      nextBw = devW;
      nextBh = devH;
    }
    W = cssW;
    H = cssH;
    bw = nextBw;
    bh = nextBh;
    update();
  }

  // ---- размер ----
  const measureBox = () => {
    const rect = canvas.getBoundingClientRect();
    resize(rect.width, rect.height, 0, 0);
  };
  let ro: ResizeObserver | null = null;
  if (typeof w.ResizeObserver === 'function') {
    ro = new w.ResizeObserver((entries) => {
      const e = entries[entries.length - 1];
      if (!e) return;
      const box = e.contentBoxSize?.[0];
      const dev = e.devicePixelContentBoxSize?.[0];
      resize(
        box ? box.inlineSize : e.contentRect.width,
        box ? box.blockSize : e.contentRect.height,
        dev ? dev.inlineSize : 0,
        dev ? dev.blockSize : 0,
      );
    });
    try {
      ro.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      ro.observe(canvas);
    }
  } else {
    w.addEventListener('resize', measureBox);
    measureBox();
  }

  // ---- смена devicePixelRatio (масштаб страницы, перенос окна на другой экран) ----
  let dprQuery: MediaQueryList | null = null;
  const onDpr = () => {
    watchDpr();
    measureBox();
  };
  function watchDpr() {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = w.matchMedia?.(`(resolution: ${w.devicePixelRatio || 1}dppx)`) ?? null;
    dprQuery?.addEventListener('change', onDpr);
  }
  watchDpr();

  // ---- прямоугольники текста и кнопки могли сдвинуться (шрифты, смена текста) ----
  let unwatch: (() => void) | null = null;
  try {
    unwatch = o.watch?.(update) ?? null;
  } catch {
    unwatch = null;
  }

  return () => {
    if (stopped) return;
    stopped = true;
    cancelIdle();
    cancelSettle();
    job = null;
    if (ro) ro.disconnect();
    else w.removeEventListener('resize', measureBox);
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = null;
    unwatch?.();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (--running === 0) cache.length = 0;
  };
}
