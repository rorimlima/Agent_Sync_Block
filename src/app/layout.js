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

        {/* PWA Meta Tags */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icons/icon-512.png" />

        {/* Windows / Edge PWA */}
        <meta name="msapplication-TileImage" content="/icons/icon-512.png" />
        <meta name="msapplication-TileColor" content="#0a0a0f" />
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
