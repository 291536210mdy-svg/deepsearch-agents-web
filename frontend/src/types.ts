export type ConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

export type MonitorEventName =
  | "session_created"
  | "tool_start"
  | "assistant_call"
  | "task_result"
  | "task_cancelled"
  | "error"
  | string;

export interface MonitorMessage {
  type: "monitor_event";
  event: MonitorEventName;
  message: string;
  data: Record<string, unknown>;
  timestamp: string;
  run_id?: string;
}

export interface PongMessage {
  type: "pong";
  message: string;
}

export type SocketMessage = MonitorMessage | PongMessage;

export interface TaskResponse {
  status: "started" | string;
  thread_id: string;
  run_id: string;
}

export interface CancelTaskResponse {
  status: "cancelled" | "cancelling" | string;
  thread_id: string;
  run_id?: string;
  message?: string;
}

export interface UploadResponse {
  status: "uploaded" | string;
  files: string[];
}

export interface OutputFile {
  name: string;
  type: "file" | string;
  path: string;
  size: number;
  mtime: number;
}

export interface FileListResponse {
  files?: OutputFile[];
  error?: string;
}

export interface ChatThreadRecord {
  id: string;
  user_id: string;
  title: string;
  status: "regular" | "archived" | "deleted" | string;
  session_path: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  metadata: Record<string, unknown>;
}

export interface ChatMessageRecord {
  id: number;
  thread_id: string;
  run_id: string;
  role: "user" | "assistant" | "system" | "tool" | "event" | string;
  content: string;
  event_type: string;
  event_json: Record<string, unknown> | null;
  files_json: unknown;
  created_at: string;
}

export interface ChatRunRecord {
  id: string;
  thread_id: string;
  user_id: string;
  status: "pending" | "running" | "success" | "error" | "timeout" | "interrupted" | string;
  query: string;
  checkpoint_id: string;
  error: string;
  created_at: string;
  started_at: string;
  finished_at: string;
  cancel_requested_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface ActiveRunResponse {
  run: ChatRunRecord | null;
}

export interface ChatListResponse {
  items: ChatThreadRecord[];
  has_more: boolean;
  next_before?: string | null;
}

export interface ChatThreadResponse {
  thread: ChatThreadRecord;
}

export interface ChatMessagesResponse {
  thread: ChatThreadRecord;
  messages: ChatMessageRecord[];
}

export interface DeleteChatResponse {
  status: "deleted" | string;
  thread_id: string;
}

export interface UploadedItem {
  uid: string;
  name: string;
  size: number;
  raw: File;
}
