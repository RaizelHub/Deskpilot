import { create } from "zustand";
import { persist } from "zustand/middleware";

interface Preferences {
  dark: boolean;
  sidebarCollapsed: boolean;
  toggleTheme: () => void;
  setTheme: (dark: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      dark: true,
      sidebarCollapsed: false,
      toggleTheme: () => set((state) => ({ dark: !state.dark })),
      setTheme: (dark: boolean) => set({ dark }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed: boolean) =>
        set({ sidebarCollapsed: collapsed }),
    }),
    { name: "deskpilot-preferences" },
  ),
);
