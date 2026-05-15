import './globals.css';
import { AuthProvider } from '@/hooks/useAuth';
import { ThemeProvider } from '@/hooks/useTheme';

export const metadata = {
  title: 'Agent Sync Block',
  description: 'Gestão de Inadimplência e Bloqueio de Veículos — Controle, sincronize e gerencie bloqueios de veículos em tempo real, online ou offline.',
  manifest: '/manifest.json',
  applicationName: 'Agent Sync Block',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Agent Sync Block',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#0a0a0f',
    'msapplication-tap-highlight': 'no',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#6366f1' },
    { media: '(prefers-color-scheme: light)', color: '#6366f1' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" crossOrigin="anonymous" />

        {/* ── PWA: iOS / Safari ── */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="SyncBlock" />
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
        <link rel="apple-touch-icon" sizes="120x120" href="/icons/icon-120.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152.png" />
        <link rel="apple-touch-icon" sizes="167x167" href="/icons/icon-167.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png" />

        {/* iOS splash screens (status bar color) */}
        <meta name="apple-touch-fullscreen" content="yes" />

        {/* ── PWA: Windows / Edge / Microsoft Store ── */}
        <meta name="msapplication-TileImage" content="/icons/icon-144.png" />
        <meta name="msapplication-TileColor" content="#0a0a0f" />
        <meta name="msapplication-square70x70logo" content="/icons/icon-71.png" />
        <meta name="msapplication-square150x150logo" content="/icons/icon-150.png" />
        <meta name="msapplication-square310x310logo" content="/icons/icon-310.png" />
        <meta name="msapplication-config" content="none" />

        {/* ── PWA: Favicons ── */}
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16.png" />
        <link rel="icon" type="image/png" sizes="96x96" href="/icons/icon-96.png" />
        <link rel="shortcut icon" href="/icons/icon-48.png" />

        {/* ── Android: Theme and status bar ── */}
        <meta name="theme-color" content="#6366f1" />
        <meta name="color-scheme" content="dark light" />
      </head>
      <body className="min-h-screen bg-bg antialiased">
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
