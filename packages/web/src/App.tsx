import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { SettingsPage } from "./pages/Settings";
import { UsersPage } from "./pages/Users";
import { TransactionsPage } from "./pages/Transactions";
import { ImportPage } from "./pages/Import";
import { FolderSyncPage } from "./pages/FolderSyncPage";
import { TransactionReviewPage } from "./pages/TransactionReviewPage";
import { BudgetPage } from "./pages/Budget";
import { KidHomePage } from "./pages/KidHome";

export function App() {
  const { user, isLoading } = useAuth();

  return (
    <>
      {/* Registered unconditionally (not inside Layout) so the service
          worker registers even on the logged-out /login screen, rather than
          only after a user signs in. */}
      <UpdatePrompt />
      {isLoading ? (
        <div className="grid min-h-screen place-items-center text-slate-400">Loading…</div>
      ) : !user ? (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      ) : user.role === "kid" ? (
        <Routes>
          <Route path="/" element={<KidHomePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/budget" element={<BudgetPage />} />
            {user.role === "admin" && (
              <>
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/import/folder-sync" element={<FolderSyncPage />} />
                <Route path="/review" element={<TransactionReviewPage />} />
              </>
            )}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </>
  );
}
