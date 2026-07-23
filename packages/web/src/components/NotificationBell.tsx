import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationDTO } from "@panditas/shared";
import { api } from "../api";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotificationDTO[]>("/notifications"),
    // Cheap poll so the badge count stays current without a full page reload
    // — this is a family LAN app, not a high-traffic service.
    refetchInterval: 60_000,
  });
  const notifications = data ?? [];
  const activeCount = notifications.filter((n) => !n.dismissedAt).length;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/dismiss`),
    onSuccess: invalidate,
  });
  const clearAll = useMutation({
    mutationFn: () => api.post("/notifications/clear-all"),
    onSuccess: () => {
      invalidate();
      setOpen(false);
    },
  });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        title="Notifications"
      >
        <BellIcon />
        {activeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-semibold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-96 max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-800">Notifications</p>
              <button
                onClick={() => clearAll.mutate()}
                disabled={notifications.length === 0 || clearAll.isPending}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
              >
                Clear all
              </button>
            </div>
            <div className="max-h-96 overflow-auto">
              {notifications.length === 0 && (
                <p className="p-4 text-sm text-slate-400">No notifications.</p>
              )}
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start justify-between gap-2 border-b border-slate-50 px-4 py-2.5 text-sm last:border-0 ${
                    n.dismissedAt ? "opacity-60" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{n.title}</p>
                    {n.detail && <p className="truncate text-xs text-slate-500">{n.detail}</p>}
                    <p className="text-xs text-slate-400">{new Date(n.createdAt).toLocaleString("en-CA")}</p>
                  </div>
                  {!n.dismissedAt && (
                    <button
                      onClick={() => dismiss.mutate(n.id)}
                      disabled={dismiss.isPending}
                      className="shrink-0 text-xs text-slate-400 hover:text-slate-700"
                    >
                      Clear
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M15.5 14.2H4.5c-.5 0-.8-.5-.5-.9l1.2-1.8V8c0-2.7 2-4.9 4.6-5.2V2c0-.4.3-.7.7-.7s.7.3.7.7v.8c2.6.3 4.6 2.5 4.6 5.2v3.5l1.2 1.8c.3.4 0 .9-.5.9Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 16.5c.4.7 1.1 1.2 2 1.2s1.6-.5 2-1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
