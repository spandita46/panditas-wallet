import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { TransactionAnomalyDTO } from "@panditas/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { APP_NAME } from "../appName";
import { NotificationBell } from "./NotificationBell";

export function Layout() {
  const { user, refresh } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu on every navigation instead of requiring an
  // onClick handler on each individual NavLink.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Same polling pattern as NotificationBell — cheap, family-LAN-app cadence.
  const { data: openAnomalies } = useQuery({
    queryKey: ["transaction-anomalies", "open"],
    queryFn: () => api.get<TransactionAnomalyDTO[]>("/review/anomalies?status=open"),
    refetchInterval: 60_000,
    enabled: user?.role === "admin",
  });
  const openAnomalyCount = openAnomalies?.length ?? 0;

  async function logout() {
    await api.post("/auth/logout");
    refresh();
  }

  const navItems = [
    { to: "/", end: true, label: "Dashboard" },
    { to: "/transactions", label: "Transactions" },
    { to: "/budget", label: "Budget" },
    ...(user?.role === "admin"
      ? [
          { to: "/settings", label: "Settings" },
          { to: "/users", label: "Users" },
          { to: "/import", label: "Import" },
          { to: "/review", label: "Review", badge: openAnomalyCount },
        ]
      : []),
  ];
  // Mobile menu items are full-width and stacked, so they need bigger tap
  // targets than the inline desktop pills use.
  function renderNavLinks(variant: "desktop" | "mobile") {
    const linkClass = ({ isActive }: { isActive: boolean }) =>
      variant === "desktop"
        ? `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? "bg-accent-600 text-white" : "text-slate-600 hover:bg-slate-100"}`
        : `block rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-accent-600 text-white" : "text-slate-600 hover:bg-slate-100"}`;
    return navItems.map(({ to, end, label, badge }) => (
      <NavLink key={to} to={to} end={end} className={linkClass}>
        {label}
        {!!badge && (
          <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}
      </NavLink>
    ));
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="-ml-1.5 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:hidden"
            >
              {menuOpen ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              )}
            </button>
            <span className="font-semibold text-slate-900">{APP_NAME}</span>
            <nav className="hidden gap-1 md:flex">{renderNavLinks("desktop")}</nav>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <span className="hidden text-sm text-slate-500 sm:inline">{user?.name}</span>
            <button
              onClick={logout}
              className="hidden rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 md:block"
            >
              Sign out
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-200 px-4 pb-3 pt-2 md:hidden">
            <nav className="flex flex-col gap-1">{renderNavLinks("mobile")}</nav>
            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
              <span className="text-sm text-slate-500">{user?.name}</span>
              <button
                onClick={logout}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
