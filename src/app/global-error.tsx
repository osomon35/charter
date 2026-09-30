"use client";

/**
 * Last resort: an error in the root layout itself, where the normal error
 * boundary has no shell to render into. Must supply its own html and body, and
 * must not depend on anything the root layout provides — including the
 * stylesheet, hence the inline styles.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fbfbfc",
          color: "#1f2430",
          font: "400 15px/1.6 -apple-system, Segoe UI, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: 360, padding: 24, textAlign: "center" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600 }}>
            Charter could not start
          </h1>
          <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>
            Reload the page. If it keeps happening, the deployment needs looking at.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "9px 18px",
              borderRadius: 6,
              border: 0,
              background: "#3b5b92",
              color: "#fff",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
