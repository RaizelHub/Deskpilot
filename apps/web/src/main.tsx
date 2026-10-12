import { Notifications } from "@/features/automation/Notifications";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import {
  Login,
  PasswordRecovery,
  Verification,
} from "@/features/auth/AuthPages";
import { useSession } from "@/features/auth/session";
import { Loading } from "@/components/shared";
import { ApiError } from "@/lib/api";
import type { ReactNode } from "react";
import "./styles.css";

const Dashboard = lazy(() =>
  import("@/features/workspace/Dashboard").then((m) => ({
    default: m.Dashboard,
  })),
);
const Roles = lazy(() =>
  import("@/features/workspace/Dashboard").then((m) => ({ default: m.Roles })),
);
const Audit = lazy(() =>
  import("@/features/workspace/Dashboard").then((m) => ({ default: m.Audit })),
);
const Roadmap = lazy(() =>
  import("@/features/workspace/Dashboard").then((m) => ({
    default: m.Roadmap,
  })),
);
const Users = lazy(() =>
  import("@/features/users/Users").then((m) => ({ default: m.Users })),
);
const Departments = lazy(() =>
  import("@/features/departments/Departments").then((m) => ({
    default: m.Departments,
  })),
);
const Account = lazy(() =>
  import("@/features/auth/Account").then((m) => ({ default: m.Account })),
);
const Tickets = lazy(() =>
  import("@/features/tickets/Tickets").then((m) => ({ default: m.Tickets })),
);
const TicketDetail = lazy(() =>
  import("@/features/tickets/TicketDetail").then((m) => ({
    default: m.TicketDetail,
  })),
);
const SlaPolicies = lazy(() =>
  import("@/features/tickets/SlaPolicies").then((m) => ({
    default: m.SlaPolicies,
  })),
);
const Devices = lazy(() =>
  import("@/features/devices/Devices").then((m) => ({ default: m.Devices })),
);
const DeviceDetail = lazy(() =>
  import("@/features/devices/Devices").then((m) => ({
    default: m.DeviceDetail,
  })),
);
const Diagnostics = lazy(() =>
  import("@/features/devices/Diagnostics").then((m) => ({
    default: m.Diagnostics,
  })),
);
const Monitoring = lazy(() =>
  import("@/features/devices/Monitoring").then((m) => ({
    default: m.Monitoring,
  })),
);
const RemoteSupport = lazy(() =>
  import("@/features/devices/RemoteSupport").then((m) => ({
    default: m.RemoteSupport,
  })),
);
const SupportRequest = lazy(() =>
  import("@/features/devices/RemoteSupport").then((m) => ({
    default: m.SupportRequest,
  })),
);
const Assets = lazy(() =>
  import("@/features/assets/Assets").then((m) => ({ default: m.Assets })),
);
const AssetDetail = lazy(() =>
  import("@/features/assets/AssetDetail").then((m) => ({
    default: m.AssetDetail,
  })),
);
const SoftwareInventory = lazy(() =>
  import("@/features/assets/SoftwareInventory").then((m) => ({
    default: m.SoftwareInventory,
  })),
);
const Automation = lazy(() =>
  import("@/features/automation/Automation").then((m) => ({
    default: m.Automation,
  })),
);
const Knowledge = lazy(() =>
  import("@/features/knowledge/Knowledge").then((m) => ({
    default: m.Knowledge,
  })),
);
const KnowledgeDetail = lazy(() =>
  import("@/features/knowledge/Knowledge").then((m) => ({
    default: m.KnowledgeDetail,
  })),
);
const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) =>
        !(
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        ) && count < 1,
    },
  },
});
function Allowed({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const session = useSession();
  return session.data?.permissions.includes(permission) ? (
    children
  ) : (
    <section className="panel account-panel">
      <h1>Access restricted</h1>
      <p>
        Your role does not include access to this area. Contact your
        administrator.
      </p>
      <Link to="/settings">Open my account</Link>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<PasswordRecovery />} />
            <Route
              path="/reset-password"
              element={<PasswordRecovery reset />}
            />
            <Route path="/verify-email" element={<Verification />} />
            <Route element={<Layout />}>
              <Route
                index
                element={
                  <Allowed permission="dashboard.view">
                    <Dashboard />
                  </Allowed>
                }
              />
              <Route
                path="users"
                element={
                  <Allowed permission="users.view">
                    <Users />
                  </Allowed>
                }
              />
              <Route
                path="departments"
                element={
                  <Allowed permission="departments.view">
                    <Departments />
                  </Allowed>
                }
              />
              <Route
                path="roles"
                element={
                  <Allowed permission="roles.view">
                    <Roles />
                  </Allowed>
                }
              />
              <Route
                path="audit"
                element={
                  <Allowed permission="audit.view">
                    <Audit />
                  </Allowed>
                }
              />
              <Route
                path="tickets"
                element={
                  <Allowed permission="tickets.view">
                    <Tickets />
                  </Allowed>
                }
              />
              <Route
                path="tickets/:id"
                element={
                  <Allowed permission="tickets.view">
                    <TicketDetail />
                  </Allowed>
                }
              />
              <Route
                path="service-targets"
                element={
                  <Allowed permission="settings.manage">
                    <SlaPolicies />
                  </Allowed>
                }
              />
              <Route
                path="devices"
                element={
                  <Allowed permission="devices.view">
                    <Devices />
                  </Allowed>
                }
              />
              <Route
                path="devices/:id"
                element={
                  <Allowed permission="devices.view">
                    <DeviceDetail />
                  </Allowed>
                }
              />
              <Route
                path="devices/:id/diagnostics"
                element={
                  <Allowed permission="devices.view">
                    <Allowed permission="devices.diagnostics">
                      <Diagnostics />
                    </Allowed>
                  </Allowed>
                }
              />
              <Route
                path="alerts"
                element={
                  <Allowed permission="monitoring.view">
                    <Monitoring />
                  </Allowed>
                }
              />
              <Route
                path="remote-support"
                element={
                  <Allowed permission="remote.request">
                    <Allowed permission="devices.view">
                      <RemoteSupport />
                    </Allowed>
                  </Allowed>
                }
              />
              <Route path="support-requests" element={<RemoteSupport mine />} />
              <Route path="support-requests/:id" element={<SupportRequest />} />
              <Route
                path="assets"
                element={
                  <Allowed permission="assets.view">
                    <Assets />
                  </Allowed>
                }
              />
              <Route
                path="assets/:id"
                element={
                  <Allowed permission="assets.view">
                    <AssetDetail />
                  </Allowed>
                }
              />
              <Route
                path="software"
                element={
                  <Allowed permission="assets.view">
                    <Allowed permission="devices.view">
                      <SoftwareInventory />
                    </Allowed>
                  </Allowed>
                }
              />
              <Route
                path="automation"
                element={
                  <Allowed permission="automation.view">
                    <Automation />
                  </Allowed>
                }
              />
              <Route path="notifications" element={<Notifications />} />
              <Route
                path="knowledge"
                element={
                  <Allowed permission="knowledge.view">
                    <Knowledge />
                  </Allowed>
                }
              />
              <Route
                path="knowledge/:id"
                element={
                  <Allowed permission="knowledge.view">
                    <KnowledgeDetail />
                  </Allowed>
                }
              />
              <Route path="settings" element={<Account />} />
              <Route path="roadmap" element={<Roadmap />} />
              <Route
                path="*"
                element={
                  <div className="empty-state">
                    <h1>Page not found</h1>
                    <Link to="/">Return to workspace</Link>
                  </div>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
