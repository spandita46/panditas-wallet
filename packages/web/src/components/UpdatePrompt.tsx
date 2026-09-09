import { useRegisterSW } from "virtual:pwa-register/react";

// Precached app-shell assets mean an open tab keeps running the old JS/CSS
// after a deploy unless told otherwise — this surfaces that instead of
// leaving stale code running silently until the next full reload.
export function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm shadow-lg">
      <span className="text-slate-700">A new version is available.</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="rounded-lg bg-accent-600 px-3 py-1 font-medium text-white hover:bg-accent-700"
      >
        Reload
      </button>
    </div>
  );
}
