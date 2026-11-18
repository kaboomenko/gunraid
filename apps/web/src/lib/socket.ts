'use client';

import { WS_EVENTS } from '@gunraid/shared';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
let clockOffset = 0;
let clockSynced = false;

/** Один Socket.IO-клиент на вкладку. В docker — тот же origin, в pnpm dev — NEXT_PUBLIC_SOCKET_URL. */
export function getSocket(): Socket {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
    socket = io(url as string, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
    socket.on(WS_EVENTS.timeSync, (p: { serverTime: number }) => {
      clockOffset = p.serverTime - Date.now();
      clockSynced = true;
    });
  }
  return socket;
}

/** Переподключение после входа/выхода, чтобы сервер увидел новые cookie. */
export function reconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

/** Серверное время (для синхронных рулеток). */
export function serverNow(): number {
  return Date.now() + clockOffset;
}

/** Запасная синхронизация часов по ответу API, пока не пришёл time:sync от сокета. */
export function noteServerTime(iso: string): void {
  if (clockSynced) return;
  const t = Date.parse(iso);
  if (Number.isFinite(t)) clockOffset = t - Date.now();
}

export function useSocketEvent<T>(event: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const fn = (p: T) => ref.current(p);
    s.on(event, fn);
    return () => {
      s.off(event, fn);
    };
  }, [event]);
}

export function useRoom(room: string | null): void {
  useEffect(() => {
    if (!room) return;
    const s = getSocket();
    const join = () => s.emit(WS_EVENTS.subscribe, room);
    join();
    s.on('connect', join);
    return () => {
      s.off('connect', join);
      s.emit(WS_EVENTS.unsubscribe, room);
    };
  }, [room]);
}
