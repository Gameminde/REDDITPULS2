import type { MetadataRoute } from "next";

import { APP_DESCRIPTION, APP_NAME } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#08090c",
    theme_color: "#08090c",
    icons: [
      {
        src: "/brand/cueidea-logo-256.png",
        sizes: "256x256",
        type: "image/png",
      },
      {
        src: "/brand/cueidea-logo-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
