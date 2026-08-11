import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Causal — Root Cause Intelligence for AI Agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LAYERS = [
  { label: "INTENT", color: "#7c3aed" },
  { label: "SPEC", color: "#2563eb" },
  { label: "REASONING", color: "#0891b2" },
  { label: "CODE", color: "#059669" },
  { label: "EXECUTION", color: "#d97706" },
  { label: "INCIDENT", color: "#dc2626" },
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#000000",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "2px solid rgba(255,255,255,0.4)",
              display: "flex",
            }}
          />
          <div style={{ color: "#ffffff", fontSize: 30, fontWeight: 600 }}>Causal</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color: "#ffffff", fontSize: 62, fontWeight: 700, lineHeight: 1.05 }}>
            Root cause in 2 minutes,
          </div>
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 62, fontWeight: 700, lineHeight: 1.05 }}>
            not 2 days.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {LAYERS.map((l, i) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  color: l.color,
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: 2,
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: `1px solid ${l.color}`,
                  background: `${l.color}18`,
                }}
              >
                {l.label}
              </div>
              {i < LAYERS.length - 1 && (
                <div style={{ display: "flex", color: "rgba(255,255,255,0.3)", fontSize: 22 }}>→</div>
              )}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
