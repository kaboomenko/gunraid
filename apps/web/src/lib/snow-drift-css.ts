/**
 * CSS-заглушка сугроба (.promo-strip::before) из тех же данных, что рисует холст (snow-drift.ts):
 * блок между маркерами <drift-placeholder> в app/globals.css генерируется здесь. snow-drift-css.test.ts
 * сверяет его с данными; `UPDATE_DRIFT_CSS=1 pnpm --filter @gunraid/web test snow-drift-css` переписывает.
 *
 * Фон — слои SVG (первый — сверху): L от левого края, C от середины, R от правого края (на узкой полосе
 * отъезжает вправо), щели с холмами на широкой полосе (гнёзда — вложенные <svg> с x/width в % щели и
 * preserveAspectRatio xMidYMax: вписаны с масштабом не больше 1, по центру, низом на низ — как gapMax на
 * холсте), подложка. Цвет по глубине — копии силуэта, сдвинутые вниз, с голубовато-серым (на глубине d
 * закрашено столько копий, сколько сдвигов не больше d).
 *
 * Тихие зоны — clip-path по той же модели потолка, что у холста (DRIFT_CAP: ровно над элементом,
 * подъём 0,55 в стороны), для раскладок текста и кнопки из DRIFT_TEXT_LAYOUTS: где текст переносится,
 * заглушка опускается так же, как холст, и смена заглушки на холст не выглядит «провалом».
 */
import {
  DRIFT_C,
  DRIFT_CAP,
  DRIFT_GAP_LEFT,
  DRIFT_GAP_RIGHT,
  DRIFT_L,
  DRIFT_LAYOUT,
  DRIFT_R,
  SNOW_DRIFT_DEFAULTS,
  driftSilhouette,
} from './snow-drift';

/** x = a·W + b, где W — ширина полосы, css px. */
type Lin = readonly [number, number];

/** Прямоугольник, к низу которого сугроб не подходит (как меряет PromoDrift): края и низ от верха полосы. */
export interface DriftLayoutRect {
  left: Lin;
  right: Lin;
  bottom: number;
}

/** Раскладка текста и кнопки полосы: широкая (md, окно от 768 px) или телефон; ширина полосы [min, max]. */
export interface DriftTextLayout {
  md: boolean;
  min: number;
  max: number;
  rects: readonly DriftLayoutRect[];
}

/**
 * Раскладки промо-полосы с текстом «+20% к депозиту / по промокоду» и кнопкой RAID2027 (шрифт TT Firs
 * Neue), снятые с живой страницы по ширинам окна 260–1300 px: строки текста (низ — по межстрочному,
 * нижняя — во всю ширину блока), видимая кнопка. Все края — линейные функции ширины полосы (текст и
 * кнопка стоят по центру или прижаты к полям). Если текст промо, шрифт или вёрстка полосы изменятся —
 * перемерить и обновить (холст тихие зоны меряет сам, это нужно только заглушке до JS).
 */
export const DRIFT_TEXT_LAYOUTS: readonly DriftTextLayout[] = [
  // телефон, 4 строки (окно 294–320; уже — текст и кнопка выходят за поля, потолок там ровный и так)
  {
    md: false,
    min: 270,
    max: 296,
    rects: [
      { left: [0, 12], right: [1, -151.45], bottom: 73.59 },
      { left: [1, -139.45], right: [1, -12], bottom: 73.59 },
    ],
  },
  // телефон, 3 строки (окно 321–339)
  {
    md: false,
    min: 297,
    max: 315,
    rects: [
      { left: [0.5, -113.25], right: [0.5, -26.2], bottom: 54.39 },
      { left: [0, 12], right: [1, -151.45], bottom: 65.59 },
      { left: [1, -139.45], right: [1, -12], bottom: 73.59 },
    ],
  },
  // телефон, 2 строки (окно 340–767)
  {
    md: false,
    min: 316,
    max: 743,
    rects: [
      { left: [0.5, -145.58], right: [0.5, 6.11], bottom: 57.59 },
      { left: [0.5, 18.11], right: [0.5, 145.56], bottom: 73.59 },
    ],
  },
  // широкая, 3 строки (окно 768–792)
  {
    md: true,
    min: 720,
    max: 744,
    rects: [
      { left: [0.5, -287.42], right: [0.5, -91.58], bottom: 86.89 },
      { left: [0, 12], right: [1, -391], bottom: 112.09 },
      { left: [1, -319], right: [1, -12], bottom: 100.09 },
    ],
  },
  // широкая, 2 строки (окно от 793)
  {
    md: true,
    min: 745,
    max: Infinity,
    rects: [
      { left: [0.5, -360.14], right: [0.5, -18.86], bottom: 94.09 },
      { left: [0.5, 53.14], right: [0.5, 360.14], bottom: 100.09 },
    ],
  },
];

/** Высота полосы и масштаб узора: широкая — 127 px (k = 1), телефон — 88 px (k = 0,693, как --snow-k). */
const STRIP = { md: { h: 127, k: 1 }, phone: { h: 88, k: 0.693 } } as const;
/** Подложка заглушки, px узора (нижний слой фона). */
const BAND_PX = 3.5;
/**
 * Допуск упрощения обрезки, css px: вершина убирается, если видимый (обрезанный) силуэт заглушки от этого
 * меняется не больше чем на TOL на всех ширинах раскладки.
 */
const TOL = 0.75;

// ---------------------------------------------------------------- фон (слои SVG)

const H = DRIFT_LAYOUT.height;
const BASE = '#eef3f9';
const DEEP = '#7d96be';
const DEEP_A = '.1';
/** Сдвиги копий для цвета по глубине: на глубине 9/15/22/30 px непрозрачность 0,1/0,19/0,27/0,34 — как у холста. */
const SHIFTS = [9, 15, 22, 30];

const num = (v: number) => {
  let s = (Math.round(v * 100) / 100).toString();
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s === '-0' ? '0' : s;
};
/** Числа подряд: минус сам разделяет. */
const seq = (vals: readonly number[]) =>
  vals.map((v, i) => (i && !num(v).startsWith('-') ? ' ' : '') + num(v)).join('');

function partPath(nodes: readonly number[]) {
  const rel: number[] = [];
  for (let i = 2; i < nodes.length; i += 2)
    rel.push(nodes[i]! - nodes[i - 2]!, -(nodes[i + 1]! - nodes[i - 1]!));
  return `M${num(nodes[0]!)} ${H}V${num(H - nodes[1]!)}l${seq(rel)}V${H}z`;
}

const bumpPath = (c: number, h: number, wl: number, wr: number) =>
  `M${num(c - wl)} ${H}c${seq([wl / 3, 0, (2 * wl) / 3, -h, wl, -h])}c${seq([wr / 3, 0, (2 * wr) / 3, h, wr, h])}z`;

/** Основная заливка — у корня (fill), копии ссылаются на силуэт без своей заливки и берут её у группы. */
const shade = (inner: string) =>
  `<g id='a'>${inner}</g><g fill='${DEEP}' fill-opacity='${DEEP_A}'>` +
  SHIFTS.map((y) => `<use href='#a' y='${y}'/>`).join('') +
  '</g>';

const svg = (attrs: string, body: string) =>
  `<svg xmlns='http://www.w3.org/2000/svg' fill='${BASE}'${attrs}>${body}</svg>`;
const enc = (s: string) =>
  s.replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3c').replace(/>/g, '%3e');
const url = (s: string) => `url("data:image/svg+xml,${enc(s)}")`;

/** Окно части: от первого до последнего узла (с концевыми спусками x может быть меньше нуля). */
const span = (nodes: readonly number[]) => [nodes[0]!, nodes[nodes.length - 2]!] as const;
const part = (nodes: readonly number[]) => {
  const [a, b] = span(nodes);
  return url(
    svg(` viewBox='${num(a)} 0 ${num(b - a)} ${H}'`, shade(`<path d='${partPath(nodes)}'/>`)),
  );
};

const gap = (slots: readonly (readonly number[])[]) => {
  let inner = '';
  for (const s of slots) {
    const [lo, hi, w] = s as [number, number, number];
    let d = '';
    for (let b = 3; b + 3 < s.length; b += 4) d += bumpPath(s[b]!, s[b + 1]!, s[b + 2]!, s[b + 3]!);
    const x = lo ? ` x='${num(lo * 100)}%'` : '';
    const wd = hi - lo !== 1 ? ` width='${num((hi - lo) * 100)}%'` : '';
    inner += `<svg${x}${wd} viewBox='0 0 ${num(w)} ${H}' preserveAspectRatio='xMidYMax'><path d='${d}'/></svg>`;
  }
  return url(svg('', shade(inner)));
};

function background(): string[] {
  const k = 'var(--snow-k)';
  const px = (v: number) => `calc(${num(v)}px * ${k})`;
  const tall = `${px(H)} no-repeat`;
  const [la, lb] = span(DRIFT_L);
  const [ca, cb] = span(DRIFT_C);
  const [ra, rb] = span(DRIFT_R);
  if (la !== 0) throw new Error('DRIFT_L must start at the strip edge');
  // calc(50% + c) ставит середину картинки шириной w в середину полосы + c
  const cOff = DRIFT_LAYOUT.centre + ca + (cb - ca) / 2;
  // R: правый край окна — у правого края полосы, на узкой полосе отъезд (slide − W) / 2; в background-position
  // 100% = W − ширина картинки, поэтому W = 100% + (rb − ra)·k
  const slideBase = DRIFT_LAYOUT.slide - (rb - ra);
  const gapW = `max(0px, 50% - ${num(DRIFT_LAYOUT.ref / 2)}px * ${k})`;
  return [
    `${part(DRIFT_L)} left bottom / ${px(lb - la)} ${tall}`,
    `${part(DRIFT_C)} calc(50% + ${num(cOff)}px * ${k}) bottom / ${px(cb - ca)} ${tall}`,
    `${part(DRIFT_R)} calc(100% + max(0px, (${num(slideBase)}px * ${k} - 100%) / 2)) bottom / ${px(rb - ra)} ${tall}`,
    `${gap(DRIFT_GAP_LEFT)} left ${px(DRIFT_LAYOUT.left)} bottom / ${gapW} ${tall}`,
    `${gap(DRIFT_GAP_RIGHT)} right ${px(DRIFT_LAYOUT.right)} bottom / ${gapW} ${tall}`,
    `linear-gradient(${BASE}, ${BASE}) bottom / 100% ${px(BAND_PX)} no-repeat`,
  ];
}

// ---------------------------------------------------------------- тихие зоны (clip-path)

/** Потолок от элемента: ровно на высоте h (css px над низом) над [a, b], подъём DRIFT_CAP.slope в стороны. */
interface Vee {
  a: number;
  b: number;
  h: number;
}

const at = (l: Lin, W: number) => l[0] * W + l[1];

function vees(layout: DriftTextLayout, W: number, only?: readonly number[]): Vee[] {
  const { h: Hs } = layout.md ? STRIP.md : STRIP.phone;
  const clearance = layout.md
    ? SNOW_DRIFT_DEFAULTS.clearance
    : SNOW_DRIFT_DEFAULTS.clearanceCompact;
  return layout.rects
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => !only || only.includes(i))
    .map(({ r }) => ({
      a: at(r.left, W) - DRIFT_CAP.pad,
      b: at(r.right, W) + DRIFT_CAP.pad,
      h: Hs - r.bottom - clearance - DRIFT_CAP.spread,
    }));
}

const veeAt = (v: Vee, x: number) => v.h + DRIFT_CAP.slope * Math.max(0, v.a - x, x - v.b);
const envAt = (vs: readonly Vee[], x: number) => Math.min(...vs.map((v) => veeAt(v, x)));

/** Силуэт заглушки (css px над низом) по столбцам x = 0…W полосы шириной W при масштабе k. */
function silhouette(W: number, k: number): Float32Array {
  const Wp = W / k;
  const pat = new Float32Array(Math.ceil(Wp) + 2);
  driftSilhouette(pat, 0, Wp);
  const out = new Float32Array(Math.floor(W) + 1);
  for (let x = 0; x < out.length; x++) {
    const u = x / k;
    const i = Math.min(pat.length - 2, Math.floor(u));
    out[x] = k * (pat[i]! + (pat[i + 1]! - pat[i]!) * (u - i));
  }
  return out;
}

/** Ширины полосы, на которых проверяется раскладка (до 3840 для открытой справа). */
function widths(layout: DriftTextLayout): number[] {
  const hi = Math.min(layout.max, 3840);
  const lo = Math.max(layout.min, 200);
  const out: number[] = [];
  const step = hi - lo > 600 ? 8 : 1;
  for (let W = lo; W <= hi; W += step) out.push(W);
  if (out[out.length - 1] !== hi) out.push(hi);
  return out;
}

/** Номера прямоугольников раскладки, потолок которых опускает сугроб хоть где-то (силуэт выше потолка − 0,3). */
function binding(layout: DriftTextLayout): number[] {
  const { k } = layout.md ? STRIP.md : STRIP.phone;
  const hit = new Set<number>();
  for (const W of widths(layout)) {
    const sil = silhouette(W, k);
    layout.rects.forEach((_, i) => {
      if (hit.has(i)) return;
      const [v] = vees(layout, W, [i]);
      for (let x = 0; x < sil.length; x++) {
        if (sil[x]! > veeAt(v!, x) - 0.3) {
          hit.add(i);
          return;
        }
      }
    });
  }
  return [...hit].sort((a, b) => a - b);
}

/** Вершины нижней огибающей потолков (x, h) слева направо, без лишних (на одной прямой). */
function envelope(vs: readonly Vee[]): [number, number][] {
  const s = DRIFT_CAP.slope;
  const xs = new Set<number>();
  for (const v of vs) {
    xs.add(v.a);
    xs.add(v.b);
    for (const u of vs) {
      if (u === v) continue;
      xs.add((u.h - v.h + s * (u.a + v.b)) / (2 * s)); // правый склон v и левый склон u
      xs.add(u.a - (v.h - u.h) / s); // ровный v и левый склон u
      xs.add(u.b + (v.h - u.h) / s); // ровный v и правый склон u
    }
  }
  const lo = Math.min(...vs.map((v) => v.a)) - 1000;
  const hi = Math.max(...vs.map((v) => v.b)) + 1000;
  const pts = [lo, ...[...xs].filter((x) => x > lo && x < hi).sort((a, b) => a - b), hi].map(
    (x) => [x, envAt(vs, x)] as [number, number],
  );
  const out: [number, number][] = [];
  for (const p of pts) {
    if (out.length && Math.abs(p[0] - out[out.length - 1]![0]) < 1e-6) continue;
    while (out.length >= 2) {
      const [q, r] = [out[out.length - 2]!, out[out.length - 1]!];
      const cross = (r[0] - q[0]) * (p[1] - q[1]) - (r[1] - q[1]) * (p[0] - q[0]);
      if (Math.abs(cross) > 1e-6 * Math.max(1, Math.abs(p[0] - q[0]))) break;
      out.pop();
    }
    out.push(p);
  }
  // крайние точки — там, где склоны выходят на верх полосы (дальше потолок не важен)
  return out;
}

/** Точки многоугольника обрезки при ширине W: [x, y от верха полосы] (крайние — на верхнем крае). */
function clipPoints(
  layout: DriftTextLayout,
  W: number,
  only: readonly number[],
): [number, number][] {
  const { h: Hs } = layout.md ? STRIP.md : STRIP.phone;
  const env = envelope(vees(layout, W, only));
  const s = DRIFT_CAP.slope;
  const first = env[1]!;
  const last = env[env.length - 2]!;
  const inner = env.slice(1, -1);
  return [
    [first[0] - (Hs - first[1]) / s, 0],
    ...inner.map(([x, h]) => [x, Hs - h] as [number, number]),
    [last[0] + (Hs - last[1]) / s, 0],
  ];
}

const coord = (a: number, b: number) => {
  const bb = Math.round(b);
  if (a === 0) return bb ? `${bb}px` : '0';
  const pct = `${a * 100}%`;
  return bb ? `calc(${pct} ${bb < 0 ? '-' : '+'} ${Math.abs(bb)}px)` : pct;
};

export interface DriftClip {
  layout: DriftTextLayout;
  /** Прямоугольники раскладки, потолок которых опускает сугроб. */
  rects: number[];
  polygon: string;
  /** Наибольшее отличие обрезанного силуэта заглушки от обрезанного потолком холста (css px) по ширинам раскладки. */
  maxErr: number;
}

/** Обрезка заглушки для каждой раскладки, где потолок что-то опускает. */
export function driftClips(): DriftClip[] {
  const out: DriftClip[] = [];
  for (const layout of DRIFT_TEXT_LAYOUTS) {
    const only = binding(layout);
    if (!only.length) continue;
    const ws = widths(layout);
    const W1 = ws[0]!;
    const W2 = ws[ws.length - 1]! > W1 ? ws[ws.length - 1]! : W1 + 1;
    const p1 = clipPoints(layout, W1, only);
    const p2 = clipPoints(layout, W2, only);
    if (p1.length !== p2.length)
      throw new Error(`clip topology changes within layout ${layout.min}..${layout.max}`);
    let lin = p1.map((p, i) => {
      const q = p2[i]!;
      const a = Math.round(((q[0] - p[0]) / (W2 - W1)) * 2) / 2;
      if (Math.abs(q[1] - p[1]) > 0.01) throw new Error('clip vertex height depends on width');
      return { a, b: Math.round((p[0] - a * W1 + (q[0] - a * W2)) / 2), y: Math.round(p[1]) };
    });
    // лишние вершины долой: обрезанный силуэт (то, что видно) не должен измениться больше чем на TOL
    const { h: Hs, k } = layout.md ? STRIP.md : STRIP.phone;
    const sils = ws.map((W) => silhouette(W, k));
    const err = (cand: typeof lin) => {
      let e = 0;
      ws.forEach((W, wi) => {
        const vs = vees(layout, W, only);
        const sil = sils[wi]!;
        const pts = cand.map((v) => [v.a * W + v.b, v.y] as const);
        let j = 0;
        for (let x = 0; x <= W; x++) {
          while (j < pts.length && pts[j]![0] <= x) j++;
          if (j === 0 || j === pts.length) continue;
          const [x0, y0] = pts[j - 1]!;
          const [x1, y1] = pts[j]!;
          const clip = Hs - (y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
          const sv = Math.max(sil[x]!, BAND_PX * k);
          e = Math.max(e, Math.abs(Math.min(sv, clip) - Math.min(sv, envAt(vs, x))));
        }
      });
      return e;
    };
    for (let i = 1; i < lin.length - 1;) {
      const cand = [...lin.slice(0, i), ...lin.slice(i + 1)];
      if (err(cand) <= TOL) lin = cand;
      else i++;
    }
    const maxErr = err(lin);
    const verts = lin.map((v) => `${coord(v.a, v.b)} ${v.y ? `${v.y}px` : '0'}`);
    const polygon = `polygon(0 100%, 0 0, ${verts.join(', ')}, 100% 0, 100% 100%)`;
    out.push({ layout, rects: only, polygon, maxErr });
  }
  return out;
}

/** Поля полосы по горизонтали (px-3 с двух сторон): @container меряет ширину без них, как и перенос текста. */
const PADDING = 24;

/**
 * Условие @container по ширине содержимого полосы (полоса − PADDING): от min раскладки (самая узкая
 * в группе — без нижней границы, на случай полос уже замеренных, например с полосой прокрутки) до min
 * следующей (самая широкая — без верхней границы).
 */
function query(l: DriftTextLayout): string {
  const group = DRIFT_TEXT_LAYOUTS.filter((x) => x.md === l.md);
  const i = group.indexOf(l);
  const lo = i > 0 ? l.min - PADDING : 0;
  const hi = i < group.length - 1 ? group[i + 1]!.min - PADDING : Infinity;
  if (!lo && hi === Infinity) return '';
  if (!lo) return `(width < ${hi}px)`;
  if (hi === Infinity) return `(width >= ${lo}px)`;
  return `(${lo}px <= width < ${hi}px)`;
}

/**
 * Блок CSS между маркерами <drift-placeholder> (без маркеров): фон заглушки и её обрезка по тихим
 * зонам; indent — отступ правил (в globals.css они внутри @layer components).
 */
export function driftPlaceholderCss(indent = ''): string {
  const i1 = indent;
  const i2 = indent + '  ';
  const i3 = indent + '    ';
  const lines: string[] = [];
  lines.push(`${i1}.promo-strip::before {`, `${i2}background:`);
  background().forEach((layer, i, all) =>
    lines.push(`${i3}${layer}${i < all.length - 1 ? ',' : ';'}`),
  );
  lines.push(`${i1}}`);
  // сначала телефон (без @media), потом широкая полоса внутри @media: на широкой полосе её правила
  // идут позже и перекрывают телефонные при той же ширине полосы
  const clips = driftClips();
  for (const md of [false, true]) {
    const list = clips.filter((c) => c.layout.md === md);
    if (!list.length) continue;
    const pad = md ? '  ' : '';
    if (md) lines.push(`${i1}@media (min-width: 768px) {`);
    for (const c of list) {
      const q = query(c.layout);
      const rule = [`${i2}.promo-strip::before {`, `${i3}clip-path: ${c.polygon};`, `${i2}}`].map(
        (l) => pad + l,
      );
      if (q) lines.push(`${i1}${pad}@container ${q} {`, ...rule, `${i1}${pad}}`);
      else lines.push(...rule.map((l) => l.slice(2)));
    }
    if (md) lines.push(`${i1}}`);
  }
  return lines.join('\n');
}
