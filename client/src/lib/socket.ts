/**
 * BeCare Socket client shim.
 * The visitor flow now persists data through the PostgreSQL-backed REST API,
 * so socket traffic is kept local and does not attempt to reach legacy hosts.
 */

import { io, Socket } from 'socket.io-client';

const _rawSocketUrl = (import.meta.env.VITE_SOCKET_URL || '').trim();
const SOCKET_URL = _rawSocketUrl || (typeof window !== 'undefined' ? window.location.origin : '');

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL || undefined, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: false,
      path: '/socket.io',
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function visitorJoin(_visitorId: string): void {
  // Persistence is now handled through the REST API.
}

export function visitorUpdatePage(_visitorId: string, _page: string, _step?: string): void {
  // Persistence is now handled through the REST API.
}

export function visitorSaveData(_visitorId: string, _payload: Record<string, any>): void {
  // Persistence is now handled through the REST API.
}

export function visitorHeartbeat(_visitorId: string): void {
  // Persistence is now handled through the REST API.
}

export function visitorSendMessage(_visitorId: string, _message: string, _senderName?: string): void {
  // Persistence is now handled through the REST API.
}

export function onVisitorRedirect(_callback: (data: { targetPage: string }) => void): () => void {
  return () => undefined;
}

export function onVisitorStatusUpdated(_callback: (data: any) => void): () => void {
  return () => undefined;
}

export function onVisitorNewMessage(_callback: (data: any) => void): () => void {
  return () => undefined;
}

export function onVisitorBlocked(_callback: () => void): () => void {
  return () => undefined;
}
