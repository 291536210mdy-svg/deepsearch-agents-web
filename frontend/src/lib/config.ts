const LOCAL_API_BASE_URL = "http://localhost:8000";
const PRODUCTION_API_BASE_URL = "https://deepsearch-agents-web-production.up.railway.app";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveWsBaseUrl(apiBaseUrl: string): string {
  if (import.meta.env.VITE_WS_BASE_URL) {
    return stripTrailingSlash(import.meta.env.VITE_WS_BASE_URL);
  }

  if (apiBaseUrl.startsWith("https://")) {
    return apiBaseUrl.replace(/^https:\/\//, "wss://");
  }

  if (apiBaseUrl.startsWith("http://")) {
    return apiBaseUrl.replace(/^http:\/\//, "ws://");
  }

  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
}

function defaultApiBaseUrl(): string {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return LOCAL_API_BASE_URL;
  }

  return PRODUCTION_API_BASE_URL;
}

export const API_BASE_URL = stripTrailingSlash(
  import.meta.env.VITE_API_BASE_URL || defaultApiBaseUrl()
);

export const WS_BASE_URL = deriveWsBaseUrl(API_BASE_URL);
