import {
  ApiOutlined,
  BranchesOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  ToolOutlined,
  TrophyOutlined
} from "@ant-design/icons";
import { Alert, App as AntApp } from "antd";
import { useEffect, useRef, useState } from "react";
import { ChatHistorySidebar } from "./components/ChatHistorySidebar";
import { ChatComposer } from "./components/ChatComposer";
import { ConversationThread } from "./components/ConversationThread";
import type { ChatTurn } from "./components/ConversationThread";
import { useChatHistory } from "./hooks/useChatHistory";
import { useDeepAgentSession } from "./hooks/useDeepAgentSession";
import type { ChatMessageRecord, ConnectionState, UploadedItem } from "./types";

function connectionLabel(state: ConnectionState): string {
  const labels: Record<ConnectionState, string> = {
    connecting: "连接中",
    connected: "已连接",
    reconnecting: "重连中",
    closed: "已关闭"
  };
  return labels[state];
}

function createTurn(content: string): ChatTurn {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
    content,
    events: [],
    files: [],
    isRunning: true,
    result: "",
    timestamp: new Date().toISOString()
  };
}

function turnsFromMessages(messages: ChatMessageRecord[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let latestUserTurn: ChatTurn | null = null;

  messages.forEach((item) => {
    if (item.role === "user") {
      latestUserTurn = {
        id: `history-user-${item.id}`,
        content: item.content,
        events: [],
        files: [],
        isRunning: false,
        result: "",
        timestamp: item.created_at
      };
      turns.push(latestUserTurn);
      return;
    }

    if (item.role === "assistant") {
      if (latestUserTurn && !latestUserTurn.result) {
        latestUserTurn.result = item.content;
        latestUserTurn.isRunning = false;
      } else {
        turns.push({
          id: `history-assistant-${item.id}`,
          content: "历史结果",
          events: [],
          files: [],
          isRunning: false,
          result: item.content,
          timestamp: item.created_at
        });
      }
    }
  });

  return turns;
}

export default function App() {
  const { message } = AntApp.useApp();
  const [query, setQuery] = useState("");
  const [stagedItems, setStagedItems] = useState<UploadedItem[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const streamRef = useRef<HTMLElement | null>(null);
  const session = useDeepAgentSession();
  const chatHistory = useChatHistory();

  useEffect(() => {
    setTurns((previous) => {
      if (previous.length === 0) {
        return previous;
      }

      const latestTurn = previous[previous.length - 1];
      const nextLatestTurn = {
        ...latestTurn,
        events: session.events,
        files: session.files,
        isRunning: session.isRunning,
        result: session.result
      };

      return [...previous.slice(0, -1), nextLatestTurn];
    });
  }, [session.events, session.files, session.isRunning, session.result]);

  useEffect(() => {
    const streamNode = streamRef.current;
    if (!streamNode) {
      return;
    }

    window.requestAnimationFrame(() => {
      streamNode.scrollTo({
        top: streamNode.scrollHeight,
        behavior: "smooth"
      });
    });
  }, [turns]);

  useEffect(() => {
    if (session.result) {
      void chatHistory.refresh();
    }
  }, [chatHistory.refresh, session.result]);

  async function handleSubmit() {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      message.warning("请输入研搜任务");
      return;
    }

    const nextTurn = createTurn(cleanQuery);
    setTurns((previous) => [...previous, nextTurn]);
    setQuery("");

    try {
      await session.submitTask(cleanQuery);
      void chatHistory.refresh();
      message.success("任务已启动，执行过程会显示在对话中");
    } catch (error) {
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === nextTurn.id
            ? {
                ...turn,
                isRunning: false,
                result: error instanceof Error ? error.message : "任务启动失败"
              }
            : turn
        )
      );
      message.error(error instanceof Error ? error.message : "任务启动失败");
    }
  }

  async function handleCancel() {
    try {
      const response = await session.cancelCurrentTask();
      message.info(response.status === "cancelling" ? "取消请求已发送，正在等待当前调用结束" : "任务已取消");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "取消任务失败");
    }
  }

  async function handleUpload(items: UploadedItem[]) {
    try {
      const response = await session.uploadFiles(items);
      setStagedItems([]);
      message.success(`已上传 ${response.files.length} 个文件`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "上传失败");
    }
  }

  async function handleNewSession() {
    try {
      await session.resetSession();
      setTurns([]);
      setQuery("");
      setStagedItems([]);
      await chatHistory.refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "新建对话失败");
    }
  }

  async function handleSelectThread(threadId: string) {
    if (threadId === session.threadId) {
      return;
    }
    if (session.isRunning) {
      message.warning("当前任务正在执行，完成或取消后再切换对话");
      return;
    }
    try {
      const messages = await session.switchSession(threadId);
      setTurns(turnsFromMessages(messages));
      setQuery("");
      setStagedItems([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载历史对话失败");
    }
  }

  async function handleDeleteThread(threadId: string) {
    try {
      await chatHistory.removeThread(threadId);
      if (threadId === session.threadId) {
        await handleNewSession();
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除对话失败");
    }
  }

  const online = session.connectionState === "connected";

  return (
    <div className="chat-app-shell min-h-dvh">
      <aside className="chat-sidebar" aria-label="会话信息">
        <div className="sidebar-brand">
          <h1>复星医药</h1>
          <p>TMOD智能员工</p>
        </div>

        <ChatHistorySidebar
          currentThreadId={session.threadId}
          error={chatHistory.error}
          hasMore={chatHistory.hasMore}
          isLoading={chatHistory.isLoading}
          isLoadingMore={chatHistory.isLoadingMore}
          onDeleteThread={handleDeleteThread}
          onLoadMore={chatHistory.loadMore}
          onNewThread={handleNewSession}
          onRefresh={chatHistory.refresh}
          onSelectThread={handleSelectThread}
          threads={chatHistory.threads}
        />

        <div className="sidebar-status-list">
          <div className={`sidebar-status ${online ? "sidebar-status--online" : "sidebar-status--warn"}`}>
            <ApiOutlined aria-hidden />
            <span>WebSocket</span>
            <strong>{connectionLabel(session.connectionState)}</strong>
          </div>
          <div className="sidebar-status">
            <BranchesOutlined aria-hidden />
            <span>助手调度</span>
            <strong>{session.stats.assistantEvents}</strong>
          </div>
          <div className="sidebar-status">
            <ToolOutlined aria-hidden />
            <span>工具调用</span>
            <strong>{session.stats.toolEvents}</strong>
          </div>
          <div className={session.stats.errorEvents > 0 ? "sidebar-status sidebar-status--error" : "sidebar-status"}>
            <CloseCircleOutlined aria-hidden />
            <span>异常</span>
            <strong>{session.stats.errorEvents}</strong>
          </div>
        </div>

        <div className="sidebar-section">
          <span className="sidebar-label">AGENTS</span>
          <ul className="agent-mini-list">
            <li>
              <CloudServerOutlined aria-hidden />
              网络搜索助手
            </li>
            <li>
              <DatabaseOutlined aria-hidden />
              数据库查询助手
            </li>
            <li>
              <FileSearchOutlined aria-hidden />
              RAGFlow 助手
            </li>
            <li>
              <TrophyOutlined aria-hidden />
              AI评优助手
            </li>
          </ul>
        </div>

      </aside>

      <main className="chat-main">
        <header className="chat-topbar">
          <div>
            <span className="panel-kicker">AI WORKSPACE</span>
            <h2>TMOD 智能工作台</h2>
          </div>
          {session.isRunning ? (
            <div className="run-indicator run-indicator--live">
              <BranchesOutlined aria-hidden />
              研搜中
            </div>
          ) : null}
        </header>

        {session.lastError ? (
          <Alert
            className="chat-alert"
            message={session.lastError}
            showIcon
            type="error"
          />
        ) : null}

        <section className="chat-stream-panel" ref={streamRef}>
          <ConversationThread
            onUseExample={setQuery}
            turns={turns}
          />
        </section>

        <ChatComposer
          isCancelling={session.isCancelling}
          isRunning={session.isRunning}
          isUploading={session.isUploading}
          onCancel={handleCancel}
          onNewSession={handleNewSession}
          onQueryChange={setQuery}
          onStagedItemsChange={setStagedItems}
          onSubmit={handleSubmit}
          onUpload={handleUpload}
          query={query}
          stagedItems={stagedItems}
          uploadedItems={session.uploadedItems}
        />
      </main>
    </div>
  );
}
