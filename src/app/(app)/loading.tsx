/**
 * Skeleton for the app routes.
 *
 * Every page here is dynamic — it reads cookies — so navigation always waits on
 * the server. Without this the viewport stays on the previous page with nothing
 * acknowledging the click, which reads as slowness even when it is fast.
 *
 * Shapes match the real layout so nothing jumps when content replaces them.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse">
      <div className="mb-8">
        <div className="h-6 w-56 rounded bg-muted" />
        <div className="mt-2.5 h-4 w-80 rounded bg-muted" />
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-24 rounded-lg border border-border bg-surface" />
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-32 rounded-lg border border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}
