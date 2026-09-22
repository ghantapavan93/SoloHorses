import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Instrument_Serif, Inter, Montserrat, Oswald } from 'next/font/google';
import { SignalDockServer } from '@/components/signals/signal-dock-server';
import { MotionProvider } from '@/components/motion/motion-provider';
import { WakingProvider } from '@/components/platform/waking';
import { Toaster } from '@/components/ui/sonner';
import { currentTheme } from '@/lib/theme';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  weight: ['600', '700', '800'],
  display: 'swap',
});
const oswald = Oswald({ subsets: ['latin'], variable: '--font-oswald', weight: ['500'], display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
// The one serif: an italic accent in editorial headlines, never in the application.
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  variable: '--font-instrument-serif',
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
});

/** Where the site lives, for absolute links in its metadata: the hosting platform says on its own machines. */
const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : (process.env.WEB_URL ?? 'http://localhost:3100');

const DESCRIPTION =
  'Unofficial candidate prototype: an operations backend for a performance-horse breeding business. All data synthetic.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Daysheet', template: '%s · Daysheet' },
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  // The card a shared link shows; the image is drawn by opengraph-image.tsx, next to this file.
  openGraph: {
    type: 'website',
    siteName: 'Daysheet',
    title: 'Daysheet — one mare, every handoff',
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: 'Daysheet — one mare, every handoff', description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0e0d0d' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await currentTheme();
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${inter.variable} ${montserrat.variable} ${oswald.variable} ${geistMono.variable} ${instrumentSerif.variable}${theme === 'dark' ? ' dark' : ''}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <WakingProvider>
          <MotionProvider>{children}</MotionProvider>
          <SignalDockServer />
          <Toaster position="top-center" richColors closeButton />
        </WakingProvider>
      </body>
    </html>
  );
}
