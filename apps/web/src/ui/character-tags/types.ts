import type { Snapshot } from '../../api';
export type TagProps = {
  snap: Snapshot;
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<any>;
};
