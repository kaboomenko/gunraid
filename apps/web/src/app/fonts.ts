import localFont from 'next/font/local';

/**
 * Фирменный шрифт TT Firs Neue (файлы — подмножество латиницы и кириллицы в woff2,
 * OpenType-функции сохранены: smcp/c2sc для капители, tnum/lnum для цифр).
 * Подгружается по требованию (preload выключен): начертаний много, а на странице
 * используется 3–5 из них; на время загрузки — Arial с подогнанными метриками.
 */
export const firsNeue = localFont({
  src: [
    { path: './fonts/TTFirsNeue-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/TTFirsNeue-Italic.woff2', weight: '400', style: 'italic' },
    { path: './fonts/TTFirsNeue-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/TTFirsNeue-MediumItalic.woff2', weight: '500', style: 'italic' },
    { path: './fonts/TTFirsNeue-DemiBold.woff2', weight: '600', style: 'normal' },
    { path: './fonts/TTFirsNeue-DemiBoldItalic.woff2', weight: '600', style: 'italic' },
    { path: './fonts/TTFirsNeue-Bold.woff2', weight: '700', style: 'normal' },
    { path: './fonts/TTFirsNeue-BoldItalic.woff2', weight: '700', style: 'italic' },
    { path: './fonts/TTFirsNeue-ExtraBold.woff2', weight: '800', style: 'normal' },
    { path: './fonts/TTFirsNeue-ExtraBoldItalic.woff2', weight: '800', style: 'italic' },
    { path: './fonts/TTFirsNeue-Black.woff2', weight: '900', style: 'normal' },
    { path: './fonts/TTFirsNeue-BlackItalic.woff2', weight: '900', style: 'italic' },
  ],
  variable: '--font-firs',
  display: 'swap',
  preload: false,
  fallback: ['Arial', 'system-ui', 'sans-serif'],
  adjustFontFallback: 'Arial',
});
