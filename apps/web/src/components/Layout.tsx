import {
  LayoutDashboard,
  Ticket,
  Monitor,
  ScreenShare,
  Inbox,
  Bell,
  Package,
  Layers,
  BookOpen,
  Zap,
  Clock3,
  ScrollText,
  Users,
  Building2,
  ShieldCheck,
  Settings,
  Search,
  ChevronDown,
  PanelLeft,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  NavLink,
  Outlet,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, json } from "@/lib/api";
import { useSession } from "@/features/auth/session";
import { usePreferences } from "@/stores/preferences";
import { Button } from "./ui/button";
import { ErrorNotice, Loading } from "./shared";
import { CommandPalette } from "./CommandPalette";
import { InboxLink } from "@/features/automation/Notifications";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;

  permission?: string | null;
  badgeKey?: "tickets" | "alerts";
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: "Workspace",
    items: [
      {
        to: "/",
        label: "Overview",
        icon: LayoutDashboard,

        permission: "dashboard.view",
      },
      {
        to: "/tickets",
        label: "Tickets",
        icon: Ticket,

        permission: "tickets.view",
        badgeKey: "tickets",
      },
      {
        to: "/devices",
        label: "Devices",
        icon: Monitor,

        permission: "devices.view",
      },
      {
        to: "/remote-support",
        label: "Remote support",
        icon: ScreenShare,

        permission: "remote.request",
      },
      {
        to: "/support-requests",
        label: "My Requests",
        icon: Inbox,

        permission: null,
      },
    ],
  },
  {
    title: "Operations",
    items: [
      {
        to: "/alerts",
        label: "Health Alerts",
        icon: Bell,

        permission: "monitoring.view",
        badgeKey: "alerts",
      },
      {
        to: "/assets",
        label: "Assets",
        icon: Package,

        permission: "assets.view",
      },
      {
        to: "/software",
        label: "Software",
        icon: Layers,

        permission: "assets.view",
      },
      {
        to: "/knowledge",
        label: "Knowledge",
        icon: BookOpen,

        permission: "knowledge.view",
      },
      {
        to: "/automation",
        label: "Automation",
        icon: Zap,

        permission: "automation.view",
      },
    ],
  },
  {
    title: "Governance",
    items: [
      {
        to: "/service-targets",
        label: "Service targets",
        icon: Clock3,

        permission: "settings.manage",
      },
      {
        to: "/audit",
        label: "Audit log",
        icon: ScrollText,

        permission: "audit.view",
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        to: "/users",
        label: "People",
        icon: Users,

        permission: "users.view",
      },
      {
        to: "/departments",
        label: "Departments",
        icon: Building2,

        permission: "departments.view",
      },
      {
        to: "/roles",
        label: "Permissions",
        icon: ShieldCheck,

        permission: "roles.view",
      },
      {
        to: "/settings",
        label: "Settings",
        icon: Settings,

        permission: null,
      },
    ],
  },
];

export function Layout() {
  const session = useSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { dark, toggleTheme, sidebarCollapsed, toggleSidebar } =
    usePreferences();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        document
          .querySelector<HTMLButtonElement>(".mobile-menu-trigger")
          ?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const logout = useMutation({
    mutationFn: () => api("/auth/logout", json("POST")),
    onSuccess: () => {
      client.clear();
      client.setQueryData(["session"], null);
    },
  });

  // Query counts for badges
  const dashboardStats = useQuery({
    queryKey: ["dashboard"],
    queryFn: () =>
      api<{ tickets: { open: number; overdue: number } }>("/dashboard"),
    enabled: !!session.data?.permissions.includes("dashboard.view"),
    staleTime: 60000,
  });

  const alertStats = useQuery({
    queryKey: ["monitoring-statistics"],
    queryFn: () =>
      api<{ active: number; critical: number }>("/monitoring-statistics"),
    enabled: !!session.data?.permissions.includes("monitoring.view"),
    staleTime: 60000,
  });

  if (session.isPending) return <Loading />;
  if (session.error)
    return (
      <ErrorNotice error={session.error} retry={() => void session.refetch()} />
    );
  if (!session.data) return <Navigate to="/login" replace />;
  if (!session.data.user.email_verified_at)
    return <Navigate to="/verify-email" replace />;

  const { user, permissions } = session.data;

  // Filter sections by permissions
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.permission || permissions.includes(item.permission),
      ),
    }))
    .filter((section) => section.items.length > 0);

  // Compute breadcrumbs title
  const currentTitle =
    navSections.flatMap((s) => s.items).find((i) => i.to === location.pathname)
      ?.label ??
    (location.pathname.startsWith("/tickets/")
      ? "Ticket Details"
      : location.pathname.startsWith("/devices/")
        ? "Device Diagnostics"
        : location.pathname.startsWith("/support-requests/")
          ? "Support Request"
          : location.pathname.startsWith("/assets/")
            ? "Asset Details"
            : location.pathname.startsWith("/knowledge/")
              ? "Article View"
              : "Workspace");

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <CommandPalette
        key={String(paletteOpen)}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNewTicket={() => navigate("/tickets?new=1")}
      />
      {mobileOpen && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation drawer"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        className={`app-sidebar ${mobileOpen ? "open" : ""}`}
        aria-label="Workspace navigation"
      >
        <div className="sidebar-brand-row">
          <NavLink
            to="/"
            className="brand-logo"
            onClick={() => setMobileOpen(false)}
          >
            <span className="brand-title">
              DeskPilot<span className="brand-period">.</span>
            </span>
          </NavLink>
          <button
            className="mobile-nav-close"
            onClick={() => setMobileOpen(false)}
          >
            Close
          </button>
        </div>
        <div className="workspace-org-pill">
          <div className="org-meta">
            <span>WORKSPACE</span>
            <strong>{user.department?.name ?? "Service desk"}</strong>
          </div>
        </div>
        <div className="sidebar-quick-actions">
          {permissions.includes("tickets.create") && (
            <Button
              icon="add"
              variant="outline"
              size="sm"
              onClick={() => {
                navigate("/tickets?new=1");
                setMobileOpen(false);
              }}
            >
              New ticket
            </Button>
          )}
          <button
            className="sidebar-search"
            onClick={() => {
              setPaletteOpen(true);
              setMobileOpen(false);
            }}
            aria-label="Search navigation"
          >
            {" "}
            <Search size={16} strokeWidth={1.7} aria-hidden="true" />
            <span>Search</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>
        <div className="sidebar-nav-container">
          {visibleSections.map((section) => (
            <div key={section.title} className="nav-group">
              <button
                className="nav-group-header nav-group-toggle"
                aria-expanded={!closedGroups[section.title]}
                aria-controls={`nav-${section.title}`}
                onClick={() =>
                  setClosedGroups((current) => ({
                    ...current,
                    [section.title]: !current[section.title],
                  }))
                }
              >
                <span>{section.title}</span>
                <ChevronDown size={12} strokeWidth={1.7} aria-hidden="true" />
              </button>
              <nav
                id={`nav-${section.title}`}
                className="nav-group-list"
                aria-label={section.title}
                hidden={!!closedGroups[section.title]}
              >
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const count =
                    item.badgeKey === "tickets"
                      ? dashboardStats.data?.tickets.open
                      : item.badgeKey === "alerts"
                        ? alertStats.data?.active
                        : undefined;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        `nav-link-item ${isActive ? "active" : ""}`
                      }
                      onClick={() => setMobileOpen(false)}
                    >
                      <Icon
                        size={16}
                        strokeWidth={1.7}
                        aria-hidden="true"
                        className="nav-link-icon"
                      />
                      <span className="nav-link-text">{item.label}</span>
                      {!!count && (
                        <span className="nav-counter-pill">{count}</span>
                      )}
                    </NavLink>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="user-meta-info">
            <span className="user-name-text">{user.name}</span>
            <span className="user-role-badge">
              {user.roles[0]?.name ?? "Member"}
            </span>
          </div>
          <button
            className="sidebar-collapse-btn"
            onClick={toggleSidebar}
            aria-pressed={sidebarCollapsed}
          >
            <PanelLeft size={14} strokeWidth={1.7} aria-hidden="true" />
            {sidebarCollapsed ? "Roomy navigation" : "Compact navigation"}
          </button>
        </div>
      </aside>
      <div className="app-main-canvas">
        <header className="app-topbar">
          <div className="topbar-left">
            <Button
              size="sm"
              variant="ghost"
              className="mobile-menu-trigger"
              aria-expanded={mobileOpen}
              aria-controls="workspace-navigation"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              Menu
            </Button>
            <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
              <span className="breadcrumb-root">Workspace</span>
              <span className="breadcrumb-sep">/</span>
              <span className="breadcrumb-current">{currentTitle}</span>
            </nav>
          </div>
          <div className="topbar-right">
            <button
              className="quick-search-trigger"
              onClick={() => setPaletteOpen(true)}
            >
              <span>Search workspace</span>
              <kbd className="search-kbd">Ctrl K</kbd>
            </button>
            <InboxLink />
            <Button size="sm" variant="ghost" onClick={toggleTheme}>
              {dark ? "Light mode" : "Dark mode"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              {logout.isPending ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </header>
        <main id="main-content" className="app-content-area">
          {logout.error && <ErrorNotice error={logout.error} />}
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>DeskPilot</span>
          <span>Support, thoughtfully organized.</span>
        </footer>
      </div>
    </div>
  );
}
