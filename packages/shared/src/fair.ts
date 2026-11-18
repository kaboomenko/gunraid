import { z } from 'zod';

export interface FairSeedDto {
  serverSeedHash: string;
  clientSeed: string;
  /** Следующий nonce. */
  nonce: number;
}

export interface RevealedSeedDto {
  id: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  /** Сколько ставок сделано с этой парой. */
  nonce: number;
  createdAt: string;
  revealedAt: string;
}

export const clientSeedSchema = z
  .object({ clientSeed: z.string().regex(/^[\x21-\x7E]{1,64}$/) })
  .strict();

export interface RotateSeedResultDto {
  revealed: RevealedSeedDto;
  current: FairSeedDto;
}

export interface CaseOpeningProofDto {
  type: 'case_opening';
  id: string;
  revealed: boolean;
  /** Раскрывается после смены пары сидов. */
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  ticket: number;
  itemId: string;
  caseName: string;
  contents: Array<{ itemId: string; odds: number; name: string; price: number }>;
  createdAt: string;
}
