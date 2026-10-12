import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { usePreferences } from "@/stores/preferences";
import { useSession } from "@/features/auth/session";

interface CommandItem {
  id: string;
  category: "Navigation" | "Quick Actions" | "Administration";
  label: string;
  sublabel?: string;

  shortcut?: string;
  permission?: string;
  action: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onNewTicket,
}: {
  open: boolean;
  onClose: () => void;
  onNewTicket?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const { dark, toggleTheme } = usePreferences();
  const session = useSession();
  const permissions = useMemo(
    () => session.data?.permissions ?? [],
    [session.data],
  );

  const items = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      {
        id: "nav-overview",
        category: "Navigation",
        label: "Overview Dashboard",
        sublabel: "Metrics, volume, and active operations",

        permission: "dashboard.view",
        action: () => navigate("/"),
      },
      {
        id: "nav-tickets",
        category: "Navigation",
        label: "Support Tickets",
        sublabel: "Active queues, priority queues, SLA targets",

        shortcut: "G T",
        permission: "tickets.view",
        action: () => navigate("/tickets"),
      },
      {
        id: "nav-devices",
        category: "Navigation",
        label: "Computers & Endpoints",
        sublabel: "Hardware specs, live status, RMM telemetry",

        shortcut: "G D",
        permission: "devices.view",
        action: () => navigate("/devices"),
      },
      {
        id: "nav-remote",
        category: "Navigation",
        label: "Remote Support Sessions",
        sublabel: "Consent-based assistance and screen share",

        shortcut: "G R",
        permission: "remote.request",
        action: () => navigate("/remote-support"),
      },
      {
        id: "nav-alerts",
        category: "Navigation",
        label: "System Health Alerts",
        sublabel: "Incident detection, disk/cpu threshold triggers",

        permission: "monitoring.view",
        action: () => navigate("/alerts"),
      },
      {
        id: "nav-assets",
        category: "Navigation",
        label: "Asset Management",
        sublabel: "Hardware inventory, assignments, warranties",

        permission: "assets.view",
        action: () => navigate("/assets"),
      },
      {
        id: "nav-knowledge",
        category: "Navigation",
        label: "Knowledge Base",
        sublabel: "IT troubleshooting articles and guides",

        permission: "knowledge.view",
        action: () => navigate("/knowledge"),
      },
      {
        id: "nav-sla",
        category: "Navigation",
        label: "Service Targets & SLA",
        sublabel: "Response and resolution SLA policy rules",

        permission: "settings.manage",
        action: () => navigate("/service-targets"),
      },
      {
        id: "act-new-ticket",
        category: "Quick Actions",
        label: "Create Support Ticket",
        sublabel: "Open a new incident or service request",

        shortcut: "C",
        permission: "tickets.create",
        action: () => {
          if (onNewTicket) onNewTicket();
          else navigate("/tickets?new=1");
        },
      },
      {
        id: "act-theme",
        category: "Quick Actions",
        label: dark ? "Switch to Light Mode" : "Switch to Dark Mode",
        sublabel: "Toggle workspace color theme",

        shortcut: "T",
        action: toggleTheme,
      },
      {
        id: "nav-users",
        category: "Administration",
        label: "People & Directory",
        sublabel: "Manage technicians, staff, and account statuses",

        permission: "users.view",
        action: () => navigate("/users"),
      },
      {
        id: "nav-departments",
        category: "Administration",
        label: "Departments",
        sublabel: "Organization units and operational teams",

        permission: "departments.view",
        action: () => navigate("/departments"),
      },
      {
        id: "nav-audit",
        category: "Administration",
        label: "Security Audit Log",
        sublabel: "Track changes, logins, and remote assistance",

        permission: "audit.view",
        action: () => navigate("/audit"),
      },
      {
        id: "nav-settings",
        category: "Administration",
        label: "My Account Settings",
        sublabel: "Profile details, password, session security",

        action: () => navigate("/settings"),
      },
    ];

    return list.filter(
      (item) => !item.permission || permissions.includes(item.permission),
    );
  }, [navigate, permissions, dark, toggleTheme, onNewTicket]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.sublabel?.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev === 0 ? Math.max(0, filtered.length - 1) : prev - 1,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const active = filtered[selectedIndex];
        if (active) {
          active.action();
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, filtered, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div
      className="command-palette-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="command-palette-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="command-palette-search">
          <input
            autoFocus
            type="text"
            placeholder="Type a command, search pages, or trigger actions…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            className="command-search-input"
          />
          <kbd className="command-esc-kbd" onClick={onClose}>
            ESC
          </kbd>
        </div>

        <div className="command-palette-results">
          {filtered.length === 0 ? (
            <div className="command-empty">
              <p>No results found for "{query}".</p>
              <small>
                Try searching for tickets, devices, remote sessions, or
                settings.
              </small>
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;

              return (
                <div
                  key={item.id}
                  className={`command-item ${isSelected ? "selected" : ""}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                >
                  <div className="command-item-text">
                    <span className="command-item-label">{item.label}</span>
                    {item.sublabel && (
                      <span className="command-item-sublabel">
                        {item.sublabel}
                      </span>
                    )}
                  </div>
                  {item.shortcut && (
                    <kbd className="command-item-shortcut">{item.shortcut}</kbd>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="command-palette-footer">
          <span>
            <kbd>Up / Down</kbd> Navigate
          </span>
          <span>
            <kbd>Enter</kbd> Select
          </span>
          <span>
            <kbd>ESC</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
