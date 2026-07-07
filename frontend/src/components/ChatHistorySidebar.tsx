import {
  DeleteOutlined,
  LoadingOutlined,
  MessageOutlined,
  PlusOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { ChatThreadRecord } from "../types";

interface ChatHistorySidebarProps {
  currentThreadId: string;
  error: string;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  onDeleteThread: (threadId: string) => Promise<void> | void;
  onLoadMore: () => Promise<void> | void;
  onNewThread: () => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  onSelectThread: (threadId: string) => Promise<void> | void;
  threads: ChatThreadRecord[];
}

type GroupKey = "today" | "yesterday" | "last7" | "last30" | "older";

const GROUP_LABELS: Record<GroupKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  older: "Older"
};

function groupForDate(value: string): GroupKey {
  const time = new Date(value || Date.now()).getTime();
  if (Number.isNaN(time)) {
    return "older";
  }

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 24 * 60 * 60 * 1000;
  const diff = Date.now() - time;

  if (time >= startToday) {
    return "today";
  }
  if (time >= startYesterday) {
    return "yesterday";
  }
  if (diff <= 7 * 24 * 60 * 60 * 1000) {
    return "last7";
  }
  if (diff <= 30 * 24 * 60 * 60 * 1000) {
    return "last30";
  }
  return "older";
}

function shortTitle(thread: ChatThreadRecord): string {
  return (thread.title || "新对话").trim() || "新对话";
}

export function ChatHistorySidebar({
  currentThreadId,
  error,
  hasMore,
  isLoading,
  isLoadingMore,
  onDeleteThread,
  onLoadMore,
  onNewThread,
  onRefresh,
  onSelectThread,
  threads
}: ChatHistorySidebarProps) {
  const grouped = threads.reduce<Record<GroupKey, ChatThreadRecord[]>>(
    (acc, thread) => {
      acc[groupForDate(thread.last_message_at || thread.updated_at || thread.created_at)].push(thread);
      return acc;
    },
    {
      today: [],
      yesterday: [],
      last7: [],
      last30: [],
      older: []
    }
  );

  return (
    <section className="chat-history" aria-label="Chats history">
      <div className="chat-history-heading">
        <span className="sidebar-label">CHATS</span>
        <div className="chat-history-actions">
          <Tooltip title="刷新历史">
            <Button
              aria-label="刷新历史"
              className="history-icon-button"
              icon={isLoading ? <LoadingOutlined /> : <ReloadOutlined />}
              onClick={() => void onRefresh()}
              size="small"
              type="text"
            />
          </Tooltip>
          <Tooltip title="新建对话">
            <Button
              aria-label="新建对话"
              className="history-icon-button"
              icon={<PlusOutlined />}
              onClick={() => void onNewThread()}
              size="small"
              type="text"
            />
          </Tooltip>
        </div>
      </div>

      {error ? <div className="chat-history-error">{error}</div> : null}

      <div className="chat-history-list">
        {threads.length === 0 && !isLoading ? (
          <div className="chat-history-empty">暂无历史对话</div>
        ) : null}

        {(Object.keys(GROUP_LABELS) as GroupKey[]).map((groupKey) => {
          const groupThreads = grouped[groupKey];
          if (groupThreads.length === 0) {
            return null;
          }

          return (
            <div className="chat-history-group" key={groupKey}>
              <div className="chat-history-group-label">{GROUP_LABELS[groupKey]}</div>
              {groupThreads.map((thread) => {
                const active = thread.id === currentThreadId;
                return (
                  <div
                    className={active ? "chat-history-item chat-history-item--active" : "chat-history-item"}
                    key={thread.id}
                    onClick={() => void onSelectThread(thread.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void onSelectThread(thread.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <MessageOutlined aria-hidden className="chat-history-item-icon" />
                    <span className="chat-history-title">{shortTitle(thread)}</span>
                    <Tooltip title="删除">
                      <span
                        aria-label="删除对话"
                        className="chat-history-delete"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onDeleteThread(thread.id);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            void onDeleteThread(thread.id);
                          }
                        }}
                      >
                        <DeleteOutlined aria-hidden />
                      </span>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {hasMore ? (
        <Button
          block
          className="history-load-more"
          loading={isLoadingMore}
          onClick={() => void onLoadMore()}
          size="small"
        >
          加载更多
        </Button>
      ) : null}
    </section>
  );
}
