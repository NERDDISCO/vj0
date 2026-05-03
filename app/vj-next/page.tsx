import { VJNextApp } from "./VJNextAppLoader";

export const metadata = {
  title: "vj0 — patch studio",
  description:
    "Scene-based composition workspace for vj0. Build scenes from primitives, " +
    "patch audio presets into properties, output to AI img2img.",
};

export default function VJNextPage() {
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
