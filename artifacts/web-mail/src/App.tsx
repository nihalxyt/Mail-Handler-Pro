import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { Toaster } from "sonner";
import LoginPage from "@/pages/login";
import InboxPage from "@/pages/inbox";
import MailDetailPage from "@/pages/mail-detail";
import SettingsPage from "@/pages/settings";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminUsers from "@/pages/admin/users";
import AdminAliases from "@/pages/admin/aliases";
import AdminLogs from "@/pages/admin/logs";
import AppLayout from "@/components/app-layout";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground font-medium">Loading ZayMail...</p>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<InboxPage />} />
        <Route path="/mail/:id" element={<MailDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/aliases" element={<AdminAliases />} />
        <Route path="/admin/logs" element={<AdminLogs />} />
        <Route
          path="*"
          element={
            <div className="flex items-center justify-center flex-1 p-8">
              <div className="text-center">
                <h2 className="text-lg font-semibold mb-1">Page not found</h2>
                <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
              </div>
            </div>
          }
        />
      </Routes>
    </AppLayout>
  );
}

function AppRouter() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <LoginPage />;
  return <AuthenticatedApp />;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRouter />
          <Toaster
            position="top-right"
            toastOptions={{
              className: "bg-card text-card-foreground border shadow-lg",
            }}
            richColors
            closeButton
          />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
