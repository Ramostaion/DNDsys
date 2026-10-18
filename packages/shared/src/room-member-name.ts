export const ROOM_DISPLAY_NAME_MAX_LENGTH = 30;

export function roomMemberName(
  member: { displayName?: string | null; user: { username: string } } | null | undefined,
  fallback = '已离开的成员',
) {
  return member?.displayName?.trim() || member?.user.username || fallback;
}
