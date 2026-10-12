export type Named = { id: string; name: string };
export type Assignment = {
  id: string;
  user: Named;
  assigner: Named;
  returner: Named | null;
  assigned_at: string;
  returned_at: string | null;
  notes: string;
  return_notes: string | null;
};
export type Asset = {
  id: string;
  tag: string;
  name: string;
  category: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  purchased_on: string | null;
  warranty_expires_on: string | null;
  warranty_state: string;
  department_id: string | null;
  department: Named | null;
  device_id: string | null;
  device: Named | null;
  location: string | null;
  status: string;
  notes: string | null;
  version: number;
  current_assignment: Assignment | null;
};
export type AssetOptions = {
  categories: string[];
  statuses: string[];
  departments: Named[];
  users: Named[];
  devices: Named[];
};
export const categories = [
  "desktop",
  "laptop",
  "monitor",
  "printer",
  "router",
  "switch",
  "access_point",
  "server",
  "ups",
  "mobile_device",
  "other",
];
export const statuses = [
  "available",
  "in_use",
  "repair",
  "retired",
  "lost",
  "disposed",
];
export const label = (value: string) =>
  value === "ups"
    ? "UPS"
    : value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export const date = (value: string | null) =>
  value
    ? new Date(
        value.length === 10 ? `${value}T12:00:00` : value,
      ).toLocaleDateString()
    : "Not recorded";
