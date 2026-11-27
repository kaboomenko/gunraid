/**
 * Падающий снег промо-полосы — частицы на Canvas 2D (вместо картинки со снежинками).
 *
 *   const stop = startSnow(canvas, { seed: 2027 });
 *   stop(); // останавливает цикл, отключает наблюдателей и очищает холст
 *
 * - Три слоя глубины, подобранные по снежинкам из макета: дальний — много мелких чётких точек,
 *   средний — мелкие и средние хлопья с чуть мягким краем, ближний — редкие крупные размытые
 *   «боке», они падают медленнее. Каждая снежинка — эллипс, вытянутый вдоль скорости (смаз
 *   движения): в макете все снежинки, и мелкие, и крупные, в 1,6–1,8 раза длиннее по диагонали.
 * - Движение без состояния: положение снежинки — чистая функция (сид, слой, номер, время). Кадр
 *   не зависит от частоты кадров, ошибка не накапливается, одинаковые сид и размер дают одинаковый
 *   кадр (стабильные скриншоты и неподвижный кадр при «уменьшить движение»). Снежинки появляются
 *   и исчезают целиком за краем холста и на каждом круге берут новую псевдослучайную колонку —
 *   у картины нет периода и швов.
 * - Плотность считается на площадь: на широкой полосе снежинок больше (с потолком), на низкой
 *   (телефон, 60px) снег мельче и медленнее при той же густоте на глаз.
 * - Спрайты (радиальный профиль с плоской вершиной) строятся один раз на размер, кадр —
 *   100–200 вызовов drawImage.
 * - Цикл стоит, когда холст вне экрана или вкладка скрыта; при prefers-reduced-motion — один кадр
 *   без анимации (настройка отслеживается на лету). Холст — в пикселях экрана (DPR до 2).
 * - При импорте не обращается к DOM и window: модуль можно импортировать в серверных компонентах,
 *   а startSnow вызывать только на клиенте (в useEffect).
 */

type Range = readonly [number, number];

export interface SnowLayer {
  /**
   * Показатель профиля прозрачности exp(−ln2·(ρ/r)^p): 2 — гаусс, больше — плоская вершина
   * и более чёткий край (в макете у мелких точек ≈ 3–4, у боке ≈ 3,5–5).
   */
  profile: number;
  /** Снежинок на 100 000 px² при опорной высоте полосы. */
  density: number;
  /** Радиус по полувысоте профиля, px (среднее геометрическое осей эллипса). */
  r: Range;
  /** Больше 1 — размеры смещены к мелким. */
  skew: number;
  /** Отношение большой оси эллипса к малой. */
  elong: Range;
  /** Непрозрачность в центре. */
  alpha: Range;
  /** Скорость падения, px/с. */
  fall: Range;
  /** Амплитуда покачивания, px. */
  sway: Range;
  /** Частота покачивания, рад/с. */
  swayFreq: Range;
}

/** Слои при опорной высоте полосы (127px): дальний, средний, ближний (рисуются в этом порядке). */
export const SNOW_LAYERS: readonly SnowLayer[] = [
  {
    profile: 4.5,
    density: 16,
    r: [0.8, 2.5],
    skew: 1.3,
    elong: [1.2, 1.6],
    alpha: [0.45, 1],
    fall: [16, 26],
    sway: [1.5, 5],
    swayFreq: [0.5, 1.2],
  },
  {
    profile: 3,
    density: 22,
    r: [2.5, 6],
    skew: 1.4,
    elong: [1.45, 1.85],
    alpha: [0.75, 1],
    fall: [26, 40],
    sway: [3, 8],
    swayFreq: [0.35, 0.9],
  },
  {
    profile: 3.5,
    density: 3,
    r: [8, 32],
    skew: 1.5,
    elong: [1.5, 1.85],
    alpha: [0.55, 0.92],
    fall: [11, 16],
    sway: [4, 10],
    swayFreq: [0.15, 0.35],
  },
];

export interface SnowOptions {
  /** Сид поля снежинок. */
  seed: number;
  /** Множитель плотности всех слоёв. */
  density: number;
  /** Потолок числа снежинок (слои уменьшаются пропорционально). */
  maxParticles: number;
  /** Потолок плотности пикселей холста. */
  maxDpr: number;
  /** Снос вправо в долях скорости падения (0,7 ≈ 35° от вертикали). */
  wind: number;
  /** Общий множитель скорости. */
  speed: number;
  /** Высота полосы, под которую подобраны слои; на другой высоте меняются размер и скорость. */
  refHeight: number;
  /** Пределы отношения высоты к опорной. */
  minScale: number;
  maxScale: number;
  /** Размер снежинок = (отношение высот)^sizeExp: больше 1 — на низкой полосе снег мельче и гуще. */
  sizeExp: number;
  /** Потолок частоты кадров (экраны 120/144 Гц рисуют ~60). 0 — без потолка. */
  fpsCap: number;
  /** Время (с) первого и неподвижного кадра. */
  startTime: number;
  /** Цвет снежинок (RGB). */
  color: readonly [number, number, number];
  /** true/false — принудительно; undefined — по prefers-reduced-motion. */
  reducedMotion: boolean | undefined;
  /** rootMargin наблюдателя видимости. */
  rootMargin: string;
  /** Вызывается один раз, когда первый кадр уже на холсте (например, чтобы плавно его показать). */
  onReady: (() => void) | undefined;
  layers: readonly SnowLayer[];
}

export const SNOW_DEFAULTS: SnowOptions = {
  seed: 2027,
  density: 1,
  maxParticles: 360,
  maxDpr: 2,
  wind: 0.7,
  speed: 1,
  refHeight: 127,
  minScale: 0.5,
  maxScale: 1.25,
  sizeExp: 1.4,
  fpsCap: 60,
  startTime: 0,
  color: [255, 255, 255],
  reducedMotion: undefined,
  rootMargin: '32px',
  onReady: undefined,
  layers: SNOW_LAYERS,
};

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

// ---------------------------------------------------------------- спрайты

/** ρ/R, где профиль опускается ниже 2/255, — размер спрайта в радиусах по полувысоте. */
const extentOf = (p: number) => Math.pow(Math.log(255 / 2) / Math.LN2, 1 / p);

/** Размеры спрайтов (радиус по полувысоте в пикселях экрана); берётся ближайший больший, сжатие ≤ 2×. */
const LEVELS = [1, 2, 4, 8, 16, 32, 64];

interface Sprite {
  canvas: HTMLCanvasElement;
  half: number;
  R: number;
}

/** Белый радиальный спрайт с прозрачностью exp(−ln2·(ρ/R)^p); мелкие — с суперсэмплингом. */
function buildSprite(
  doc: Document,
  p: number,
  R: number,
  color: SnowOptions['color'],
): Sprite | null {
  const ext = extentOf(p);
  const half = Math.ceil(R * ext) + 1;
  const size = half * 2;
  const canvas = doc.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;
  // Таблица профиля по q = (ρ/R)², q ∈ [0, ext²].
  const LUT = 1024;
  const qMax = ext * ext;
  const lut = new Float32Array(LUT + 2);
  for (let i = 0; i <= LUT + 1; i++)
    lut[i] = Math.exp(-Math.LN2 * Math.pow((i / LUT) * qMax, p / 2));
  const img = g.createImageData(size, size);
  const d = img.data;
  const ss = R <= 2 ? 6 : R <= 8 ? 3 : 1;
  const scale = LUT / qMax / (R * R);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let sy = 0; sy < ss; sy++) {
        const dy = y + (sy + 0.5) / ss - half;
        for (let sx = 0; sx < ss; sx++) {
          const dx = x + (sx + 0.5) / ss - half;
          const q = (dx * dx + dy * dy) * scale;
          if (q < LUT) {
            const i = q | 0;
            acc += lut[i]! + (lut[i + 1]! - lut[i]!) * (q - i);
          }
        }
      }
      const a = Math.round((255 * acc) / (ss * ss));
      const k = (y * size + x) * 4;
      d[k] = color[0];
      d[k + 1] = color[1];
      d[k + 2] = color[2];
      d[k + 3] = a < 2 ? 0 : a;
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas, half, R };
}

// ---------------------------------------------------------------- поле снежинок

interface Flake {
  id: number;
  r: number;
  e: number;
  alpha: number;
  fall: number;
  windJ: number;
  swayA: number;
  swayW: number;
  swayP: number;
  x0: number;
  y0: number;
  // Считаются в layout().
  m: number;
  span: number;
  wspan: number;
  sx: number;
  sy: number;
  sprite: Sprite | null;
  // Колонка текущего круга.
  cyc: number;
  jit: number;
}

function makeFlake(seed: number, layerIndex: number, index: number, L: SnowLayer): Flake {
  const rand = rng(hash3(seed, layerIndex + 1, index));
  return {
    id: ((layerIndex + 1) << 20) | index,
    r: lerp(L.r, Math.pow(rand(), L.skew)),
    e: lerp(L.elong, rand()),
    alpha: lerp(L.alpha, rand()),
    fall: lerp(L.fall, rand()),
    windJ: (rand() - 0.5) * 0.16,
    swayA: lerp(L.sway, rand()),
    swayW: lerp(L.swayFreq, rand()),
    swayP: rand() * Math.PI * 2,
    x0: rand(),
    y0: rand(),
    m: 0,
    span: 1,
    wspan: 1,
    sx: 1,
    sy: 1,
    sprite: null,
    cyc: -1,
    jit: 0,
  };
}

/** Система частиц: снежинки, спрайты и render(ctx, time). */
function createField(o: SnowOptions, doc: Document) {
  const layers = o.layers;
  const seed = o.seed >>> 0;
  /** Снежинки каждого слоя по номеру — переживают изменение размера. */
  const pool: Flake[][] = layers.map(() => []);
  const sprites = new Map<number, Sprite | null>();
  let flakes: Flake[] = [];
  let W = 0; // CSS px
  let H = 0;
  let bw = 0; // пиксели холста
  let bh = 0;
  let dpr = 1;
  let px = 1; // пикселей холста на CSS px (≈ dpr, точно после округления)
  let py = 1;
  let kv = 1; // множитель скорости и покачивания (= отношение высот)

  function spriteFor(layerIndex: number, rDev: number) {
    let level = LEVELS.length - 1;
    for (let i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i]! >= rDev) {
        level = i;
        break;
      }
    }
    const key = layerIndex * 16 + level;
    if (!sprites.has(key)) {
      sprites.set(key, buildSprite(doc, layers[layerIndex]!.profile, LEVELS[level]!, o.color));
    }
    return sprites.get(key) ?? null;
  }

  function layout() {
    kv = Math.min(o.maxScale, Math.max(o.minScale, H / o.refHeight));
    const k = Math.pow(kv, o.sizeExp); // множитель размера снежинок
    const area = (W * H) / 1e5 / (k * k);
    const want = layers.map((L) => L.density * o.density * area);
    const total = want.reduce((a, b) => a + b, 0);
    const cap = total > o.maxParticles ? o.maxParticles / total : 1;
    const next: Flake[] = [];
    layers.forEach((L, li) => {
      const n = Math.round(want[li]! * cap);
      const list = pool[li]!;
      const ext = extentOf(L.profile);
      for (let i = 0; i < n; i++) {
        const f = (list[i] ??= makeFlake(seed, li, i, L));
        const r = f.r * k;
        const se = Math.sqrt(f.e);
        const maj = r * se;
        const min = r / se;
        f.m = maj * ext + 1;
        f.span = H + 2 * f.m;
        f.wspan = W + 2 * f.m;
        f.cyc = -1;
        f.sprite = spriteFor(li, r * dpr);
        if (f.sprite) {
          f.sx = (maj * dpr) / f.sprite.R;
          f.sy = (min * dpr) / f.sprite.R;
        }
        next.push(f);
      }
    });
    flakes = next; // от дальних к ближним: боке рисуются последними
  }

  return {
    setSize(cssW: number, cssH: number, backW: number, backH: number, ratio: number) {
      W = cssW;
      H = cssH;
      bw = backW;
      bh = backH;
      dpr = ratio;
      px = W > 0 ? bw / W : dpr;
      py = H > 0 ? bh / H : dpr;
      layout();
    },

    /** Рисует кадр на момент `time` (с). false — рисовать нечего (нулевой размер). */
    render(ctx: CanvasRenderingContext2D, time: number): boolean {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, bw, bh);
      if (!W || !H) return false;
      const tt = time * o.speed;
      for (const f of flakes) {
        const sprite = f.sprite;
        if (!sprite) continue;
        const { m, span, wspan } = f;
        const fall = f.fall * kv;
        const yy = f.y0 * span + fall * tt;
        const cyc = Math.floor(yy / span);
        const y = yy - cyc * span - m;
        if (cyc !== f.cyc) {
          // Новый круг — новая псевдослучайная колонка (снежинка сейчас за краем холста).
          f.cyc = cyc;
          f.jit = (hash3(seed, f.id, cyc) / 4294967296) * wspan;
        }
        const vx = fall * (o.wind + f.windJ);
        const swayA = f.swayA * kv;
        const ph = f.swayW * tt + f.swayP;
        let x = f.x0 * wspan + f.jit + vx * tt + swayA * Math.sin(ph);
        x = x - Math.floor(x / wspan) * wspan - m;
        if (y + m < 0 || y - m > H || x + m < 0 || x - m > W) continue;
        // Вытягиваем вдоль мгновенной скорости (смаз движения).
        const dvx = vx + swayA * f.swayW * Math.cos(ph);
        const inv = 1 / Math.sqrt(dvx * dvx + fall * fall);
        const c = dvx * inv;
        const s = fall * inv;
        ctx.globalAlpha = f.alpha;
        ctx.setTransform(c * f.sx, s * f.sx, -s * f.sy, c * f.sy, x * px, y * py);
        ctx.drawImage(sprite.canvas, -sprite.half, -sprite.half);
      }
      return true;
    },

    dispose() {
      sprites.clear();
      flakes = [];
    },
  };
}

/** Цикл на requestAnimationFrame с потолком частоты кадров; после долгой паузы снег не «прыгает». */
function createLoop(win: Window, fpsCap: number, step: (dt: number) => void) {
  const minInterval = fpsCap > 0 ? (1000 / fpsCap) * 0.66 : 0;
  let id = 0;
  let prev = -1;
  function tick(now: number) {
    id = win.requestAnimationFrame(tick);
    if (prev < 0) prev = now;
    const elapsed = now - prev;
    if (elapsed < minInterval) return;
    prev = now;
    step(Math.min(elapsed, 100) / 1000);
  }
  return {
    start() {
      if (id) return;
      prev = -1;
      id = win.requestAnimationFrame(tick);
    },
    stop() {
      if (!id) return;
      win.cancelAnimationFrame(id);
      id = 0;
    },
  };
}

// ---------------------------------------------------------------- запуск

/**
 * Запускает снег на холсте, размер которого задан стилями (например, position:absolute; inset:0;
 * width:100%; height:100%). Возвращает функцию остановки.
 */
export function startSnow(canvas: HTMLCanvasElement, options?: Partial<SnowOptions>): () => void {
  const o: SnowOptions = { ...SNOW_DEFAULTS, ...options };
  const doc = canvas.ownerDocument;
  const win = doc.defaultView ?? window;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return () => undefined;
  const g = ctx;

  const field = createField(o, doc);
  let t = o.startTime;
  let ready = false;
  const draw = () => {
    if (!field.render(g, t)) return;
    if (!ready) {
      ready = true;
      o.onReady?.();
    }
  };
  const loop = createLoop(win, o.fpsCap, (dt) => {
    t += dt;
    draw();
  });

  let W = 0; // CSS px
  let H = 0;
  let bw = 0; // пиксели холста
  let bh = 0;
  let dpr = 0;
  let inView = typeof IntersectionObserver === 'undefined';
  let reduced = false;
  let stopped = false;

  const sync = () => {
    if (!stopped && inView && !doc.hidden && !reduced && W > 0 && H > 0) loop.start();
    else loop.stop();
  };

  function resize(cssW: number, cssH: number, devW: number, devH: number) {
    const ratio = win.devicePixelRatio || 1;
    const nextDpr = Math.min(ratio, o.maxDpr);
    let nextBw = Math.round(cssW * nextDpr);
    let nextBh = Math.round(cssH * nextDpr);
    // Точный размер в пикселях экрана (1:1), если он согласуется с DPR (при эмуляции DPR
    // некоторые окружения отдают тут размер в CSS px).
    if (
      ratio <= o.maxDpr &&
      devW > 0 &&
      devH > 0 &&
      Math.abs(devW - cssW * ratio) < 1.5 &&
      Math.abs(devH - cssH * ratio) < 1.5
    ) {
      nextBw = devW;
      nextBh = devH;
    }
    if (cssW === W && cssH === H && nextDpr === dpr && nextBw === bw && nextBh === bh) return;
    W = cssW;
    H = cssH;
    dpr = nextDpr;
    bw = nextBw;
    bh = nextBh;
    if (canvas.width !== bw) canvas.width = bw; // смена размера очищает холст…
    if (canvas.height !== bh) canvas.height = bh;
    field.setSize(W, H, bw, bh, dpr);
    draw(); // …поэтому рисуем сразу (колбэки ResizeObserver идут до отрисовки страницы)
    sync();
  }

  // ---- размер ----
  const measure = () => {
    const rect = canvas.getBoundingClientRect();
    resize(rect.width, rect.height, 0, 0);
  };
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver((entries) => {
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
    win.addEventListener('resize', measure);
    measure();
  }

  // ---- смена devicePixelRatio (масштаб страницы, перенос окна на другой экран) ----
  let dprQuery: MediaQueryList | null = null;
  const onDpr = () => {
    watchDpr();
    measure();
  };
  function watchDpr() {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = win.matchMedia?.(`(resolution: ${win.devicePixelRatio || 1}dppx)`) ?? null;
    dprQuery?.addEventListener('change', onDpr);
  }
  watchDpr();

  // ---- «уменьшить движение» ----
  const motionQuery =
    o.reducedMotion === undefined
      ? (win.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null)
      : null;
  reduced = o.reducedMotion ?? !!motionQuery?.matches;
  const onMotion = () => {
    reduced = !!motionQuery?.matches;
    sync();
    if (reduced) draw(); // замираем на текущем кадре
  };
  motionQuery?.addEventListener('change', onMotion);

  // ---- видимость ----
  let io: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (e) inView = e.isIntersecting;
        sync();
      },
      { rootMargin: o.rootMargin },
    );
    io.observe(canvas);
  }
  const onVisibility = () => sync();
  doc.addEventListener('visibilitychange', onVisibility);

  return () => {
    if (stopped) return;
    stopped = true;
    loop.stop();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    field.dispose();
    if (ro) ro.disconnect();
    else win.removeEventListener('resize', measure);
    io?.disconnect();
    dprQuery?.removeEventListener('change', onDpr);
    motionQuery?.removeEventListener('change', onMotion);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
