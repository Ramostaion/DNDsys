import type { Snapshot } from '../../api';
import type { PresentationCurrent } from '../presentation/usePresentation';

export type RoomPanelProps = {
  snap: Snapshot;
  me: { id: string; username: string };
  isGM: boolean;
  mutate: (type: string, payload: Record<string, unknown>, operationId?: string) => Promise<any>;
  refresh: () => Promise<any>;
  presentation: PresentationCurrent | null;
  refreshPresentation: () => Promise<void>;
};
