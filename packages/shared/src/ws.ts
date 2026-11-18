/** Имена событий Socket.IO и комнат. Через WS клиент ничего не решает — только получает события. */
export const WS_EVENTS = {
  statsUpdate: 'stats:update',
  feedDrop: 'feed:drop',
  caseSupply: 'case:supply',
  battlesUpsert: 'battles:upsert',
  battlesRemove: 'battles:remove',
  battleState: 'battle:state',
  battleRound: 'battle:round',
  battleFinished: 'battle:finished',
  balanceUpdate: 'balance:update',
  inventoryUpdate: 'inventory:update',
  notificationNew: 'notification:new',
  timeSync: 'time:sync',
  subscribe: 'subscribe',
  unsubscribe: 'unsubscribe',
} as const;

export const WS_ROOMS = {
  feed: (game: string) => `feed:${game}`,
  battles: (game: string) => `battles:${game}`,
  battle: (id: string) => `battle:${id}`,
  case: (id: string) => `case:${id}`,
  user: (id: string) => `user:${id}`,
} as const;

/** Комнаты, на которые клиент может подписаться сам (личная user:* — только автоматически). */
export const PUBLIC_ROOM_RE = /^(feed|battles):[a-z0-9-]{2,32}$|^(battle|case):[0-9a-f-]{36}$/;

export interface CaseSupplyPayload {
  caseId: string;
  supplyUsed: number;
  supplyTotal: number;
}

export interface StatsUpdatePayload {
  online: number;
  casesOpened?: number;
}

export interface BalanceUpdatePayload {
  balance: number;
}

export interface TimeSyncPayload {
  serverTime: number;
}
