import { v7 } from 'uuid';

/** UUIDv7: упорядочены по времени, не перебираются. */
export function newId(): string {
  return v7();
}
