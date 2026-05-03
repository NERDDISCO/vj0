import { VJNextApp } from "./vj-next/VJNextAppLoader";

export const metadata = {
  title: "vj0 — patch studio",
  description:
    "Scene-based composition workspace. Build scenes from primitives, " +
    "patch audio presets into properties, output to AI img2img.",
};

// The homepage now serves the new "Patch Studio" UI directly.
// The old layout still ships at /vj-legacy (see app/vj-legacy/page.tsx)
// so you can A/B compare while the new flow stabilizes — useful for any
// feature that hasn't been ported yet (e.g. the full DMX panel, recording
// pipeline, AI WebRTC transport wiring).
export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        width: "100vw",
        background: "#04040a",
        color: "var(--vj-ink)",
      }}
    >
      <VJNextApp />
    </main>
  );
}
