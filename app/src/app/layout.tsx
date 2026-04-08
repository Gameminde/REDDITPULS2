import type { Metadata } from 'next';
import { Suspense } from "react";
import './globals.css';
import { AuthSessionBridge } from '@/app/components/auth-session-bridge';
import { ThreeBackgroundWrapper } from '@/app/components/ThreeBackgroundWrapper';
import { AnalyticsTracker } from '@/lib/analytics-client';
import { APP_DESCRIPTION, APP_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
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
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning>
        <ThreeBackgroundWrapper />
        <div className="relative z-10 w-full min-h-screen">
          <Suspense fallback={null}>
            <AnalyticsTracker />
            <AuthSessionBridge />
          </Suspense>
          {children}
        </div>
      </body>
    </html>
  );
}
