/**
 * Собственные плейсхолдеры для демо-предметов: простые «рубленые» силуэты,
 * окрашенные в цвета скина (c1 — основной, c2 — дополнительный). Никаких изображений правообладателей.
 * Пример: /media/demo/rifle.svg?c1=C6FF00&c2=2A2D36
 */
const DARK = '#2b2f3a';
const METAL = '#3d4352';
const SHINE = 'rgba(255,255,255,0.22)';

type Part = [path: string, fill: 'c1' | 'c2' | 'dark' | 'metal' | 'shine'];

const SHAPES: Record<string, Part[]> = {
  rifle: [
    ['M14 58 L60 50 L66 56 L66 74 L28 84 L14 80 Z', 'c2'],
    ['M64 48 L150 48 L156 54 L156 70 L66 74 Z', 'c1'],
    ['M70 48 L148 48 L152 52 L72 54 Z', 'shine'],
    ['M84 58 L140 58 L136 64 L80 64 Z', 'c2'],
    ['M108 70 L128 70 L140 104 L120 108 Z', 'c2'],
    ['M78 72 L92 72 L86 98 L74 98 Z', 'dark'],
    ['M154 50 L200 50 L204 54 L204 66 L156 68 Z', 'c2'],
    ['M202 55 L246 55 L246 61 L202 61 Z', 'metal'],
    ['M232 46 L238 46 L238 55 L232 55 Z', 'metal'],
    ['M110 42 L118 42 L120 48 L108 48 Z', 'metal'],
  ],
  sniper: [
    ['M10 60 L56 52 L62 58 L62 76 L40 78 L26 90 L10 88 Z', 'c2'],
    ['M60 50 L140 50 L146 56 L146 68 L62 72 Z', 'c1'],
    ['M66 50 L138 50 L142 54 L68 56 Z', 'shine'],
    ['M70 58 L130 58 L128 63 L68 63 Z', 'c2'],
    ['M78 30 L134 30 L142 36 L134 42 L78 42 L72 36 Z', 'dark'],
    ['M134 31 L141 36 L134 41 Z', 'c1'],
    ['M90 42 L96 42 L96 50 L90 50 Z', 'metal'],
    ['M118 42 L124 42 L124 50 L118 50 Z', 'metal'],
    ['M144 56 L250 56 L250 61 L144 61 Z', 'metal'],
    ['M238 53 L252 53 L252 64 L238 64 Z', 'dark'],
    ['M80 70 L92 70 L88 92 L76 92 Z', 'dark'],
  ],
  pistol: [
    ['M70 40 L184 40 L190 46 L190 62 L70 62 Z', 'c1'],
    ['M76 44 L180 44 L182 48 L76 48 Z', 'shine'],
    ['M76 62 L170 62 L166 70 L80 70 Z', 'c2'],
    ['M80 68 L112 68 L104 112 L76 112 L72 100 Z', 'c2'],
    ['M112 68 L134 68 L128 84 L112 84 Z', 'dark'],
    ['M186 48 L196 48 L196 56 L186 56 Z', 'metal'],
    ['M84 80 L102 80 L98 100 L82 100 Z', 'shine'],
  ],
  smg: [
    ['M24 60 L64 56 L64 62 L30 66 Z', 'metal'],
    ['M62 48 L170 48 L176 54 L176 72 L64 74 Z', 'c1'],
    ['M68 48 L168 48 L172 52 L70 54 Z', 'shine'],
    ['M90 56 L160 56 L158 62 L88 62 Z', 'c2'],
    ['M110 72 L126 72 L124 112 L108 112 Z', 'c2'],
    ['M78 72 L92 72 L88 96 L76 96 Z', 'dark'],
    ['M174 56 L214 56 L214 63 L174 63 Z', 'metal'],
    ['M80 42 L150 42 L152 48 L78 48 Z', 'metal'],
  ],
  shotgun: [
    ['M10 60 L60 52 L66 58 L66 76 L24 86 L10 82 Z', 'c2'],
    ['M64 50 L130 50 L136 56 L136 70 L66 74 Z', 'c1'],
    ['M70 50 L128 50 L132 54 L72 56 Z', 'shine'],
    ['M134 52 L250 52 L250 59 L134 59 Z', 'metal'],
    ['M134 61 L232 61 L232 67 L134 67 Z', 'dark'],
    ['M160 60 L206 60 L210 64 L206 70 L160 70 L156 64 Z', 'c2'],
    ['M78 72 L92 72 L86 96 L74 96 Z', 'dark'],
  ],
  knife: [
    ['M20 70 L92 62 L98 74 L28 88 Z', 'c2'],
    ['M10 70 L20 66 L24 80 L14 84 Z', 'metal'],
    ['M92 56 L104 54 L108 82 L96 84 Z', 'metal'],
    ['M104 58 L200 46 L236 48 L206 66 L108 78 Z', 'c1'],
    ['M110 74 L206 64 L220 58 L206 60 L110 70 Z', 'shine'],
    ['M120 62 L190 53 L188 57 L122 66 Z', 'c2'],
  ],
  gloves: [
    ['M96 40 L160 40 L172 64 L168 100 L104 104 L88 70 Z', 'c1'],
    ['M100 18 L112 18 L114 42 L100 42 Z', 'c1'],
    ['M116 14 L128 14 L130 40 L116 40 Z', 'c1'],
    ['M132 16 L144 16 L144 40 L132 40 Z', 'c1'],
    ['M148 22 L158 22 L158 44 L148 44 Z', 'c1'],
    ['M168 58 L190 46 L196 54 L176 74 Z', 'c1'],
    ['M100 70 L168 66 L168 74 L100 78 Z', 'c2'],
    ['M102 100 L168 96 L170 116 L104 120 Z', 'c2'],
    ['M104 44 L150 44 L156 52 L108 56 Z', 'shine'],
  ],
  sticker: [
    ['M84 20 L172 20 L188 36 L188 92 L172 108 L84 108 L68 92 L68 36 Z', 'c2'],
    ['M90 28 L166 28 L180 42 L180 86 L166 100 L90 100 L76 86 L76 42 Z', 'c1'],
    [
      'M128.0 38.0 L134.5 55.1 L152.7 56.0 L138.5 67.4 L143.3 85.0 L128.0 75.0 L112.7 85.0 L117.5 67.4 L103.3 56.0 L121.5 55.1 Z',
      'c2',
    ],
    ['M90 28 L166 28 L172 34 L84 34 Z', 'shine'],
  ],
  charm: [
    ['M126 30 L130 30 L130 48 L126 48 Z', 'metal'],
    ['M108 48 L148 48 L160 64 L148 104 L108 104 L96 64 Z', 'c1'],
    ['M114 56 L142 56 L150 66 L142 96 L114 96 L106 66 Z', 'c2'],
    ['M108 48 L148 48 L152 54 L104 54 Z', 'shine'],
  ],
  graffiti: [
    [
      'M96 30 L120 40 L140 22 L150 44 L178 38 L168 62 L190 76 L160 82 L164 106 L138 92 L118 110 L110 86 L80 94 L92 72 L68 60 L94 52 Z',
      'c1',
    ],
    ['M110 56 L150 52 L146 72 L112 76 Z', 'c2'],
  ],
};

/** Кейс — открытый ящик со «стрелочными» гранями (квадратный viewBox 0 0 256 256). */
const CASE_PARTS: Part[] = [
  ['M40 112 L216 112 L232 132 L232 220 L216 236 L40 236 L24 220 L24 132 Z', 'c2'],
  ['M40 112 L216 112 L232 132 L24 132 Z', 'shine'],
  ['M52 140 L204 140 L204 220 L52 220 Z', 'c1'],
  ['M52 140 L204 140 L204 152 L52 152 Z', 'shine'],
  ['M24 132 L232 132 L232 144 L24 144 Z', 'dark'],
  ['M112 164 L144 164 L150 176 L144 188 L112 188 L106 176 Z', 'c2'],
  ['M120 170 L136 170 L140 176 L136 182 L120 182 L116 176 Z', 'c1'],
  ['M30 108 L64 38 L224 26 L234 46 L76 60 L48 112 Z', 'c1'],
  ['M64 38 L224 26 L230 38 L70 50 Z', 'shine'],
  ['M48 112 L76 60 L234 46 L214 98 L200 98 L214 60 L84 72 L62 112 Z', 'c2'],
  ['M96 200 L160 200 L160 210 L96 210 Z', 'dark'],
];

function color(value: string | null, fallback: string): string {
  return value && /^[0-9A-Fa-f]{6}$/.test(value) ? `#${value}` : fallback;
}

export async function GET(request: Request, { params }: { params: Promise<{ shape: string }> }) {
  const { shape: raw } = await params;
  const shape = raw.replace(/\.svg$/, '');
  const isCase = shape === 'case';
  const parts = isCase ? CASE_PARTS : SHAPES[shape];
  if (!parts) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  const c1 = color(url.searchParams.get('c1'), '#C6FF00');
  const c2 = color(url.searchParams.get('c2'), '#2A2D36');
  const fills = { c1, c2, dark: DARK, metal: METAL, shine: SHINE } as const;
  const body = parts.map(([d, f]) => `<path d="${d}" fill="${fills[f]}"/>`).join('');
  const ring =
    shape === 'charm'
      ? `<circle cx="128" cy="22" r="9" fill="none" stroke="${METAL}" stroke-width="4"/>`
      : '';
  const size = isCase
    ? 'viewBox="0 0 256 256" width="256" height="256"'
    : 'viewBox="0 0 256 128" width="256" height="128"';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${size}>${ring}${body}</svg>`;
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
