import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/recognize — API info
 * POST /api/recognize — handled by serve.ts (see recognize.handler.ts)
 */
export const Route = createFileRoute("/api/recognize")({
  component: ApiRecognizeInfo,
});

function ApiRecognizeInfo() {
  return (
    <div style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>NoteSnap Recognition API</h1>
      <h2>POST /api/recognize</h2>
      <p>
        Accepts <code>multipart/form-data</code> with an <code>audio</code> file.
      </p>
      <h3>Supported formats</h3>
      <ul>
        <li>Opus/OGG (preferred)</li>
        <li>WAV/PCM (fallback)</li>
        <li>Any format ffmpeg can decode</li>
      </ul>
      <h3>Limits</h3>
      <ul>
        <li>Max file size: 5 MB</li>
        <li>Free tier: 5 recognitions per month</li>
      </ul>
      <h3>Response</h3>
      <pre>{`{
  "success": true,
  "matches": [{ "piece_id": "...", "title": "...", "confidence": 0.94 }],
  "query_duration_ms": 2340
}`}</pre>
    </div>
  );
}
