import type { InitiativeCalculation, InitiativeWeight } from './initiative.js';
export type InitiativePresetView = { id: string; name: string; weights: InitiativeWeight[]; version: number };
export type TurnStateBadge = {
  id: string;
  name: string;
  icon: string;
  color: string;
  romanNumeral?: string;
  remainingTurns: number | null;
};
export type TurnTransition = {
  operationId: string;
  version: number;
  endedCharacterId?: string;
  changed: {
    id: string;
    characterId: string;
    name: string;
    icon: string;
    color: string;
    romanNumeral?: string;
    before: number;
    after: number;
  }[];
};
export type TurnSessionView = {
  id: string;
  mapId: string | null;
  mapName: string;
  status: 'ACTIVE' | 'PAUSED' | 'LIMIT';
  round: number;
  totalRounds: number | null;
  currentCharacterId: string | null;
  version: number;
  participants: {
    characterId: string;
    tokenId: string;
    name: string;
    avatarUrl: string | null;
    isNpc: boolean;
    score?: number;
    calculation?: InitiativeCalculation;
    firstRound: number;
    lastActedRound: number;
    tokenMissing?: boolean;
    states: TurnStateBadge[];
  }[];
  transition: TurnTransition | null;
};
