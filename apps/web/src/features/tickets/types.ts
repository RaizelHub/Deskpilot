export interface Person {
  id: string;
  name: string;
}
export interface Ticket {
  id: string;
  number: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  version: number;
  requester: Person | null;
  requester_id: string | null;
  assignee: Person | null;
  assignee_id: string | null;
  category: Person;
  category_id: string;
  department: Person | null;
  reported_device: string | null;
  tags: Person[];
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  first_response_due_at: string;
  resolution_due_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  sla: { response_breached: boolean; resolution_breached: boolean };
  permissions: Record<
    "update" | "assign" | "resolve" | "notes" | "reply" | "reopen",
    boolean
  >;
}
export interface Options {
  categories: Person[];
  statuses: string[];
  priorities: string[];
}
export interface Comment {
  id: string;
  body: string;
  is_internal: boolean;
  author: Person;
  created_at: string;
}
export interface Attachment {
  id: string;
  filename: string;
  size: number;
  is_internal: boolean;
  uploader: Person;
}
export interface History {
  id: string;
  action: string;
  actor: Person | null;
  details: Record<string, unknown>;
  created_at: string;
}
export const label = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
