/**
 * Собственные плейсхолдеры для демо-предметов: простые «рубленые» силуэты,
 * окрашенные в цвета скина (c1 — основной, c2 — дополнительный), и сундук для демо-кейсов.
 * Никаких изображений правообладателей.
 * Пример: /media/demo/rifle.svg?c1=C6FF00&c2=2A2D36, /media/demo/chest.svg?c1=7FD8FF&c2=2A2D36
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

/** Смешивает два цвета #RRGGBB: t — доля первого. */
function mix(a: string, b: string, t: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v * t + y[i]! * (1 - t))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * Кейс — закрытый сундук в духе макета: ручки на крышке, лаймовые защёлки, металлические углы,
 * эмблема-прицел. c1 — цвет кейса (корпус — его затемнённый вариант), c2 — шов под крышкой.
 * Квадрат 256×256, сундук занимает середину — сверху остаётся место под название карточки,
 * снизу плашка с ценой ложится на низ корпуса, как в макете.
 */
function chestSvg(c1: string, c2: string): string {
  const body = mix(c1, '#16181f', 0.58);
  const bodyDark = mix(c1, '#0b0c10', 0.3);
  const lidTop = mix(c1, '#ffffff', 0.78);
  const emblem = mix(c1, '#ffffff', 0.42);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs>
<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${body}"/><stop offset="1" stop-color="${bodyDark}"/></linearGradient>
<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lidTop}"/><stop offset="1" stop-color="${body}"/></linearGradient>
<linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
<linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6eaf2"/><stop offset=".5" stop-color="#a3abbb"/><stop offset="1" stop-color="#5d6476"/></linearGradient>
<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1f7"/><stop offset="1" stop-color="#737b8d"/></linearGradient>
</defs>
<ellipse cx="128" cy="228" rx="104" ry="11" fill="#000" opacity=".5"/>
<path d="M50 52 H206 L228 78 H28 Z" fill="url(#t)"/>
<path d="M50 52 H206" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
<g fill="none" stroke="url(#h)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
<path d="M70 70 V50 Q70 40 80 40 H100 Q110 40 110 50 V70"/>
<path d="M146 70 V50 Q146 40 156 40 H176 Q186 40 186 50 V70"/>
</g>
<rect x="26" y="76" width="204" height="42" rx="8" fill="url(#b)"/>
<rect x="26" y="76" width="204" height="42" rx="8" fill="url(#s)"/>
<path d="M32 78 H224" stroke="#fff" stroke-opacity=".3" stroke-width="2"/>
<rect x="26" y="114" width="204" height="9" fill="${c2}"/>
<rect x="32" y="121" width="192" height="96" rx="8" fill="url(#b)"/>
<rect x="32" y="121" width="192" height="96" rx="8" fill="url(#s)"/>
<path d="M38 124 H218" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>
<rect x="28" y="206" width="200" height="16" rx="6" fill="${bodyDark}"/>
<g fill="url(#m)">
<path d="M26 98 V84 Q26 74 36 74 H50 V86 H38 V98 Z"/>
<path d="M230 98 V84 Q230 74 220 74 H206 V86 H218 V98 Z"/>
<path d="M28 196 V212 Q28 224 40 224 H56 V212 H40 V196 Z"/>
<path d="M228 196 V212 Q228 224 216 224 H200 V212 H216 V196 Z"/>
</g>
<g fill="#454b5b"><circle cx="33" cy="81" r="2.5"/><circle cx="223" cy="81" r="2.5"/><circle cx="35" cy="217" r="2.5"/><circle cx="221" cy="217" r="2.5"/></g>
<g fill="url(#m)"><rect x="70" y="92" width="24" height="9" rx="2"/><rect x="162" y="92" width="24" height="9" rx="2"/></g>
<g fill="#B7FF00"><rect x="72" y="99" width="20" height="44" rx="4"/><rect x="164" y="99" width="20" height="44" rx="4"/></g>
<g fill="#26300a"><rect x="77" y="121" width="10" height="16" rx="2"/><rect x="169" y="121" width="10" height="16" rx="2"/></g>
<g fill="#fff" opacity=".35"><rect x="74" y="101" width="3" height="18" rx="1.5"/><rect x="166" y="101" width="3" height="18" rx="1.5"/></g>
<g fill="none" stroke="${emblem}" stroke-width="5" stroke-linecap="round" opacity=".9">
<circle cx="128" cy="170" r="21"/>
<path d="M128 140 V156 M128 184 V200 M98 170 H114 M142 170 H158"/>
</g>
<circle cx="128" cy="170" r="4.5" fill="${emblem}" opacity=".9"/>
</svg>`;
}

function color(value: string | null, fallback: string): string {
  return value && /^[0-9A-Fa-f]{6}$/.test(value) ? `#${value}` : fallback;
}

export async function GET(request: Request, { params }: { params: Promise<{ shape: string }> }) {
  const { shape: raw } = await params;
  const shape = raw.replace(/\.svg$/, '');
  const url = new URL(request.url);
  const c1 = color(url.searchParams.get('c1'), '#C6FF00');
  const c2 = color(url.searchParams.get('c2'), '#2A2D36');
  // chest — текущий адрес демо-кейсов; case — прежний (на случай непереписанных ссылок).
  if (shape === 'chest' || shape === 'case') return svgResponse(chestSvg(c1, c2));
  const parts = SHAPES[shape];
  if (!parts) return new Response('Not found', { status: 404 });
  const fills = { c1, c2, dark: DARK, metal: METAL, shine: SHINE } as const;
  const body = parts.map(([d, f]) => `<path d="${d}" fill="${fills[f]}"/>`).join('');
  const ring =
    shape === 'charm'
      ? `<circle cx="128" cy="22" r="9" fill="none" stroke="${METAL}" stroke-width="4"/>`
      : '';
  return svgResponse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 128" width="256" height="128">${ring}${body}</svg>`,
  );
}

function svgResponse(svg: string): Response {
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
