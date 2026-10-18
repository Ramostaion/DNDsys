export type CombatDraftSide = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  d20: number;
  bonus: number;
  total: number;
  attributeName?: string;
};
export type CombatDraftView = {
  id: string;
  revision: number;
  eventId: string;
  expiresAt: string;
  serverNow: number;
  state: string;
  skippedReason?: string;
  contest?: { attacker: CombatDraftSide; defender: CombatDraftSide; hit: boolean };
};
