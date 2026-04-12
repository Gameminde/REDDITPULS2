import Image from "next/image";

import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="flex flex-col items-center gap-5 text-center">
        <div
          className="relative h-[86px] w-[86px]"
          style={{ filter: "drop-shadow(0 0 28px rgba(249,115,22,0.34))" }}
        >
          <Image
            src="/brand/cueidea-logo-512.png"
            alt={`${APP_NAME} logo`}
            fill
            priority
            sizes="86px"
            className="object-contain"
          />
        </div>

        <div className="space-y-1.5">
          <div className="font-display text-[28px] font-extrabold tracking-[-0.04em] text-white">
            {APP_NAME}
          </div>
          <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-primary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          Loading
        </div>
      </div>
    </div>
  );
}
