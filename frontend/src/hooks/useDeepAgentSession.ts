import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelTask,
  cancelRun,
  createChat,
  getActiveRun,
  getChatMessages,
  listSessionFiles,
  startTask,
  uploadSessionFiles
} from "../lib/api";
import { WS_BASE_URL } from "../lib/config";
import { getStoredThreadId, storeThreadId } from "../lib/thread";
import type {
  ChatMessageRecord,
  ConnectionState,
  MonitorMessage,
  OutputFile,
  SocketMessage,
  UploadedItem
} from "../types";

const MAX_EVENTS = 120;

function extractString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" ? value : null;
}

export function useDeepAgentSession() {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  const heartbeatTimerRef = useRef<number | undefined>(undefined);
  const uploadedNameSetRef = useRef<Set<string>>(new Set());
  const currentRunIdRef = useRef("");
  const ignoredRunIdsRef = useRef<Set<string>>(new Set());
  const [threadId, setThreadId] = useState(getStoredThreadId);
  const [currentRunId, setCurrentRunId] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [events, setEvents] = useState<MonitorMessage[]>([]);
  const [files, setFiles] = useState<OutputFile[]>([]);
  const [sessionPath, setSessionPath] = useState("");
  const [result, setResult] = useState("");
  const [lastError, setLastError] = useState("");
  const [lastPongAt, setLastPongAt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedItems, setUploadedItems] = useState<UploadedItem[]>([]);

  const clearSocketTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = undefined;
    }
  }, []);

  const clearSessionState = useCallback(() => {
    setEvents([]);
    setFiles([]);
    setSessionPath("");
    setResult("");
    setLastError("");
    setUploadedItems([]);
    uploadedNameSetRef.current.clear();
    currentRunIdRef.current = "";
    setCurrentRunId("");
    setIsRunning(false);
    setIsCancelling(false);
  }, []);

  const syncActiveRun = useCallback(async (targetThreadId: string) => {
    const response = await getActiveRun(targetThreadId);
    const activeRun = response.run;
    if (activeRun && (activeRun.status === "pending" || activeRun.status === "running")) {
      currentRunIdRef.current = activeRun.id;
      setCurrentRunId(activeRun.id);
      setIsRunning(true);
      setIsCancelling(false);
      return activeRun;
    }
    currentRunIdRef.current = "";
    setCurrentRunId("");
    setIsRunning(false);
    setIsCancelling(false);
    return null;
  }, []);

  const resetSession = useCallback(async () => {
    const response = await createChat();
    storeThreadId(response.thread.id);
    setThreadId(response.thread.id);
    clearSessionState();
    return response.thread;
  }, [clearSessionState]);

  const hydrateMessages = useCallback(async (targetThreadId = threadId): Promise<ChatMessageRecord[]> => {
    const response = await getChatMessages(targetThreadId);
    setSessionPath(response.messages.length > 0 ? response.thread.session_path || "" : "");
    setLastError("");
    await syncActiveRun(targetThreadId);
    return response.messages;
  }, [syncActiveRun, threadId]);

  const switchSession = useCallback(async (nextThreadId: string): Promise<ChatMessageRecord[]> => {
    const response = await getChatMessages(nextThreadId);
    storeThreadId(nextThreadId);
    setThreadId(nextThreadId);
    clearSessionState();
    setSessionPath(response.messages.length > 0 ? response.thread.session_path || "" : "");
    await syncActiveRun(nextThreadId);
    return response.messages;
  }, [clearSessionState, syncActiveRun]);

  const refreshFiles = useCallback(async () => {
    if (!sessionPath) {
      return;
    }

    const response = await listSessionFiles(sessionPath);
    if (response.error) {
      throw new Error(response.error);
    }
    setFiles(response.files || []);
  }, [sessionPath]);

  useEffect(() => {
    let disposed = false;

    function connect() {
      clearSocketTimers();
      const hadSocket = Boolean(socketRef.current);
      socketRef.current?.close();
      setConnectionState(hadSocket ? "reconnecting" : "connecting");

      const socket = new WebSocket(`${WS_BASE_URL}/ws/${encodeURIComponent(threadId)}`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          return;
        }
        setConnectionState("connected");
        setLastError("");
        heartbeatTimerRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 25000);
      };

      socket.onmessage = (event) => {
        if (socketRef.current !== socket) {
          return;
        }
        try {
          const payload = JSON.parse(event.data) as SocketMessage;
          if (payload.type === "pong") {
            setLastPongAt(new Date().toISOString());
            return;
          }

          if (payload.type !== "monitor_event") {
            return;
          }

          const payloadRunId = payload.run_id || extractString(payload.data, "run_id") || "";
          if (payloadRunId && ignoredRunIdsRef.current.has(payloadRunId)) {
            return;
          }
          if (payloadRunId && currentRunIdRef.current && payloadRunId !== currentRunIdRef.current) {
            return;
          }

          setEvents((previous) => [...previous, payload].slice(-MAX_EVENTS));

          if (payload.event === "session_created") {
            const path = extractString(payload.data, "path");
            if (path) {
              setSessionPath(path);
            }
          }

          if (payload.event === "task_result") {
            const finalResult = extractString(payload.data, "result");
            setResult(finalResult || payload.message);
            currentRunIdRef.current = "";
            setCurrentRunId("");
            setIsRunning(false);
            setIsCancelling(false);
          }

          if (payload.event === "task_cancelled") {
            if (payloadRunId) {
              ignoredRunIdsRef.current.add(payloadRunId);
            }
            setResult((previous) => previous || payload.message);
            currentRunIdRef.current = "";
            setCurrentRunId("");
            setIsRunning(false);
            setIsCancelling(false);
          }

          if (payload.event === "error") {
            setLastError(payload.message);
            currentRunIdRef.current = "";
            setCurrentRunId("");
            setIsRunning(false);
            setIsCancelling(false);
          }
        } catch (error) {
          setLastError(error instanceof Error ? error.message : "WebSocket 消息解析失败");
        }
      };

      socket.onerror = () => {
        if (!disposed && socketRef.current === socket) {
          setLastError("WebSocket 连接异常，请确认后端服务已启动");
        }
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) {
          return;
        }
        clearSocketTimers();
        if (disposed) {
          setConnectionState("closed");
          return;
        }
        setConnectionState("reconnecting");
        reconnectTimerRef.current = window.setTimeout(connect, 2000);
      };
    }

    connect();

    return () => {
      disposed = true;
      clearSocketTimers();
      socketRef.current?.close();
    };
  }, [clearSocketTimers, threadId]);

  useEffect(() => {
    if (!sessionPath) {
      return;
    }

    refreshFiles().catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : "文件列表刷新失败");
    });

    const timer = window.setInterval(() => {
      refreshFiles().catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : "文件列表刷新失败");
      });
    }, isRunning ? 2500 : 6000);

    return () => window.clearInterval(timer);
  }, [isRunning, refreshFiles, sessionPath]);

  const submitTask = useCallback(
    async (query: string) => {
      const cleanQuery = query.trim();
      if (!cleanQuery) {
        throw new Error("请输入研搜任务");
      }

      setIsRunning(true);
      setIsCancelling(false);
      setEvents([]);
      setResult("");
      setLastError("");
      if (currentRunIdRef.current) {
        ignoredRunIdsRef.current.add(currentRunIdRef.current);
        currentRunIdRef.current = "";
        setCurrentRunId("");
      }
      try {
        const response = await startTask(cleanQuery, threadId);
        if (response.thread_id && response.thread_id !== threadId) {
          storeThreadId(response.thread_id);
          setThreadId(response.thread_id);
        }
        currentRunIdRef.current = response.run_id;
        setCurrentRunId(response.run_id);
        setIsRunning(true);
        setIsCancelling(false);
        return response;
      } catch (error) {
        setIsRunning(false);
        setIsCancelling(false);
        throw error;
      }
    },
    [threadId]
  );

  const cancelCurrentTask = useCallback(async () => {
    if (!isRunning) {
      throw new Error("当前没有正在执行的任务");
    }

    setIsCancelling(true);
    setLastError("");
    try {
      const runId = currentRunIdRef.current;
      const response = runId ? await cancelRun(threadId, runId) : await cancelTask(threadId);
      if (response.status === "cancelled") {
        const cancelledRunId = response.run_id || runId;
        if (cancelledRunId) {
          ignoredRunIdsRef.current.add(cancelledRunId);
        }
        currentRunIdRef.current = "";
        setCurrentRunId("");
        setIsRunning(false);
        setIsCancelling(false);
        setResult((previous) => previous || "任务已取消");
      }
      return response;
    } catch (error) {
      setIsCancelling(false);
      throw error;
    }
  }, [isRunning, threadId]);

  const uploadFiles = useCallback(
    async (items: UploadedItem[]) => {
      if (items.length === 0) {
        throw new Error("请选择要上传的文件");
      }

      const nextItems = items.filter((item) => !uploadedNameSetRef.current.has(item.name));

      if (nextItems.length === 0) {
        return {
          status: "uploaded",
          files: Array.from(uploadedNameSetRef.current)
        };
      }

      setIsUploading(true);
      setLastError("");
      try {
        const response = await uploadSessionFiles(
          nextItems.map((item) => item.raw),
          threadId
        );
        setUploadedItems((previous) => {
          const names = new Set(previous.map((item) => item.name));
          const next = [...previous];
          nextItems.forEach((item) => {
            if (!names.has(item.name)) {
              names.add(item.name);
              uploadedNameSetRef.current.add(item.name);
              next.push(item);
            }
          });
          return next;
        });
        return response;
      } finally {
        setIsUploading(false);
      }
    },
    [threadId]
  );

  const stats = useMemo(() => {
    const toolEvents = events.filter((event) => event.event === "tool_start").length;
    const assistantEvents = events.filter((event) => event.event === "assistant_call").length;
    const errorEvents = events.filter((event) => event.event === "error").length;

    return {
      toolEvents,
      assistantEvents,
      errorEvents,
      fileCount: files.length
    };
  }, [events, files.length]);

  return {
    connectionState,
    currentRunId,
    events,
    files,
    isCancelling,
    isRunning,
    isUploading,
    lastError,
    lastPongAt,
    hydrateMessages,
    refreshFiles,
    resetSession,
    result,
    sessionPath,
    stats,
    cancelCurrentTask,
    submitTask,
    switchSession,
    threadId,
    uploadFiles,
    uploadedItems
  };
}
