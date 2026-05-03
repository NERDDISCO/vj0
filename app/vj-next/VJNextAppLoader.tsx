"use client";

import dynamic from "next/dynamic";

// Same SSR-skip rationale as /vj — every meaningful surface in this route
// uses browser-only APIs (AudioContext, Canvas, navigator.mediaDevices) and
// the Zustand stores hydrate from localStorage. SSRing default state and then
// flashing to persisted state on hydrate makes the UI look broken on every
// reload, so we just wait for the client.
export const VJNextApp = dynamic(
  () => import("./VJNextApp").then((m) => m.VJNextApp),
  { ssr: false },
);
