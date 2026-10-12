export interface Role {
  id: string;
  name: string;
  slug: string;
  permissions?: { id: string; name: string }[];
}
export interface Department {
  id: string;
  name: string;
  description: string | null;
  users_count: number;
}
export interface User {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  email_verified_at: string | null;
  department_id: string | null;
  department: Department | null;
  roles: Role[];
  created_at: string;
}
export interface Session {
  user: User;
  permissions: string[];
}
export interface AuditEntry {
  id: string;
  action: string;
  actor: { id: string; name: string } | null;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
export interface Page<T> {
  data: T[];
  meta?: { current_page: number; last_page: number; total: number };
  current_page?: number;
  last_page?: number;
  total?: number;
}
export interface Dashboard {
  users: number | null;
  active_users: number | null;
  departments: number | null;
  roles: number | null;
  recent_activity: AuditEntry[];
}
