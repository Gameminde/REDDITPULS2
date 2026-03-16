"use client";
import dynamic from "next/dynamic";

const ThreeBackgroundNoSSR = dynamic(
  () => import("./ThreeBackground").then((mod) => mod.ThreeBackground),
  { ssr: false }
);

export function ThreeBackgroundWrapper() {
  return <ThreeBackgroundNoSSR />;
}
