import { AuthSession } from '../types';

/**
 * Checks if the current user is an administrator.
 * For this demo, we'll consider any email ending with '@elec-admin.com' as an admin.
 * @param session The current user's authentication session.
 * @returns True if the user is an admin, false otherwise.
 */
export const isAdmin = (session: AuthSession | null): boolean => {
  if (!session || !session.user || !session.user.email) {
    return false;
  }
  // 특정 관리자 이메일 또는 @elec-admin.com 도메인
  return session.user.email === 'admin@gmail.com' ||
    session.user.email.endsWith('@elec-admin.com');
};
