import { useCallback, useEffect, useState } from "react";
import { deleteChat, listChats } from "../lib/api";
import type { ChatThreadRecord } from "../types";

export function useChatHistory() {
  const [threads, setThreads] = useState<ChatThreadRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await listChats(20);
      setThreads(response.items);
      setHasMore(response.has_more);
      setNextBefore(response.next_before || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "聊天历史加载失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextBefore || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    setError("");
    try {
      const response = await listChats(20, nextBefore);
      setThreads((previous) => [...previous, ...response.items]);
      setHasMore(response.has_more);
      setNextBefore(response.next_before || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更多聊天历史加载失败");
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, nextBefore]);

  const removeThread = useCallback(async (threadId: string) => {
    await deleteChat(threadId);
    setThreads((previous) => previous.filter((thread) => thread.id !== threadId));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    error,
    hasMore,
    isLoading,
    isLoadingMore,
    loadMore,
    refresh,
    removeThread,
    threads
  };
}
