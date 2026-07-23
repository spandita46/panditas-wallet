import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SIMPLEFIN_BRIDGE_URL, type NotificationDTO } from "@panditas/shared";
import { api } from "../../api";

function useDismiss() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };
  const dismissOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/dismiss`),
    onSuccess: invalidate,
  });
  const dismissMany = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.post(`/notifications/${id}/dismiss`))),
    onSuccess: invalidate,
  });
  return { dismissOne, dismissMany };
}

function DismissButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Clear"
      className="shrink-0 text-current opacity-60 hover:opacity-100 disabled:opacity-30"
    >
      ✕
    </button>
  );
}

export function NotificationBanners({ notifications }: { notifications: NotificationDTO[] }) {
  const { dismissOne, dismissMany } = useDismiss();

  const stale = notifications.filter((n) => n.type === "stale_institution");
  const orphaned = notifications.filter((n) => n.type === "orphaned_account");
  const swing = notifications.filter((n) => n.type === "net_worth_swing");
  const discovered = notifications.filter((n) => n.type === "new_account" || n.type === "new_institution");

  if (notifications.length === 0) return null;

  return (
    <>
      {stale.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p>
              <strong>{stale.length}</strong> connection(s) need attention in SimpleFIN. Balances shown may be
              stale.
            </p>
            <a
              href={SIMPLEFIN_BRIDGE_URL}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 whitespace-nowrap font-medium hover:underline"
            >
              Reconnect ↗
            </a>
          </div>
          <ul className="space-y-0.5">
            {stale.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-2">
                <span>
                  <strong>{n.title}</strong>
                  {n.detail ? ` — ${n.detail}` : ""}
                </span>
                <DismissButton onClick={() => dismissOne.mutate(n.id)} disabled={dismissOne.isPending} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {discovered.length > 0 && (
        <div className="rounded-xl border border-accent-200 bg-accent-50 p-4 text-sm text-accent-800">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p>
              <strong>{discovered.length}</strong> new account(s)/institution(s) discovered. Confirm this isn't an
              unintended duplicate (e.g. from a SimpleFIN reconnect) — see{" "}
              <Link to="/settings" className="underline">
                Settings
              </Link>{" "}
              to merge if it is.
            </p>
            <button
              onClick={() => dismissMany.mutate(discovered.map((n) => n.id))}
              disabled={dismissMany.isPending}
              className="shrink-0 whitespace-nowrap font-medium hover:underline disabled:opacity-50"
            >
              Acknowledge all
            </button>
          </div>
          <ul className="space-y-0.5">
            {discovered.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-2">
                <span>
                  <strong>{n.title}</strong>
                  {n.type === "new_account" ? ` — new account under ${n.detail}` : " — new institution"}
                </span>
                <DismissButton onClick={() => dismissOne.mutate(n.id)} disabled={dismissOne.isPending} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {orphaned.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="mb-2">
            <strong>{orphaned.length}</strong> account(s) stopped receiving updates even though their institution
            just synced fine — may be a duplicate needing a merge. See{" "}
            <Link to="/settings" className="underline">
              Settings
            </Link>
            .
          </p>
          <ul className="space-y-0.5">
            {orphaned.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-2">
                <strong>{n.title}</strong>
                <DismissButton onClick={() => dismissOne.mutate(n.id)} disabled={dismissOne.isPending} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {swing.map((n) => (
        <div key={n.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="flex items-center justify-between gap-3">
            <p>{n.detail}</p>
            <DismissButton onClick={() => dismissOne.mutate(n.id)} disabled={dismissOne.isPending} />
          </div>
        </div>
      ))}
    </>
  );
}
