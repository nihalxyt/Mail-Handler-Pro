import { Switch, Route, Router as WouterRouter } from "wouter";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { ThemeProvider } from "@/contexts/theme-context";
import LoginPage from "@/pages/login";
import InboxPage from "@/pages/inbox";
import MailDetailPage from "@/pages/mail-detail";
import SettingsPage from "@/pages/settings";
import AppLayout from "@/components/app-layout";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={InboxPage} />
        <Route path="/mail/:id" component={MailDetailPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route>
          <div className="flex items-center justify-center flex-1 p-8">
            <p className="text-muted-foreground">Page not found</p>
          </div>
        </Route>
      </Switch>
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
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRouter />
        </WouterRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
