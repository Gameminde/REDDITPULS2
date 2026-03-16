import type { Metadata } from 'next';
import './globals.css';
import { ThreeBackgroundWrapper } from '@/app/components/ThreeBackgroundWrapper';

export const metadata: Metadata = {
  title: "RedditPulse",
  description: "Extract. Validate. Dominate.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning>
        <ThreeBackgroundWrapper />
        <div className="relative z-10 w-full min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
