export default function VaultSkeleton() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="h-11 w-full max-w-xl rounded-xl bg-surface" />
        <div className="flex gap-3">
          <div className="h-11 w-36 rounded-xl bg-surface" />
          <div className="h-11 w-28 rounded-xl bg-accent/20" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="glass rounded-xl p-4">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-surface" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-surface" />
                <div className="h-3 w-1/4 rounded bg-surface" />
              </div>
              <div className="h-8 w-24 rounded bg-surface" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
