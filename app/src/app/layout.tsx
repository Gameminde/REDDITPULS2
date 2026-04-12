import type { Metadata } from 'next';
import { Suspense } from "react";
import './globals.css';
import { AuthSessionBridge } from '@/app/components/auth-session-bridge';
import { ThreeBackgroundWrapper } from '@/app/components/ThreeBackgroundWrapper';
import { AnalyticsTracker } from '@/lib/analytics-client';
import { APP_DESCRIPTION, APP_NAME } from '@/lib/brand';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://cueidea.me";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${APP_NAME} | Startup Idea Radar`,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  keywords: [
    "CueIdea",
    "startup ideas",
    "startup opportunity radar",
    "validate startup ideas",
    "pain point radar",
    "saas opportunities",
    "indie hacker tools",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: APP_NAME,
    title: `${APP_NAME} | Startup Idea Radar`,
    description: "See startup demand before you build. CueIdea turns repeated public pain into startup opportunities you can inspect and validate.",
  },
  twitter: {
    card: "summary",
    title: `${APP_NAME} | Startup Idea Radar`,
    description: "See startup demand before you build. Live pain signals become product opportunities.",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/brand/cueidea-logo-256.png", type: "image/png", sizes: "256x256" }],
  },
  manifest: "/manifest.webmanifest",
  category: "business",
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
