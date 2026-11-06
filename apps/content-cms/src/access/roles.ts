import type { Access, FieldAccess, PayloadRequest } from 'payload';

export const roles = ['admin', 'reviewer', 'editor'] as const;
export type Role = (typeof roles)[number];

type MaybeUser = { collection?: string; role?: unknown } | null | undefined;

/** Only members of the `users` auth collection are human staff. */
export const roleOf = (user: MaybeUser): Role | null =>
  user?.collection === 'users' &&
  typeof user.role === 'string' &&
  (roles as readonly string[]).includes(user.role)
    ? (user.role as Role)
    : null;

export const hasRole = (user: MaybeUser, ...allowed: Role[]): boolean => {
  const role = roleOf(user);
  return role !== null && allowed.includes(role);
};

export const isStaff: Access = ({ req }) => roleOf(req.user) !== null;
export const isAdmin: Access = ({ req }) => hasRole(req.user, 'admin');
export const isEditorial: Access = ({ req }) =>
  hasRole(req.user, 'admin', 'reviewer', 'editor');
export const isReviewer: Access = ({ req }) =>
  hasRole(req.user, 'admin', 'reviewer');
export const nobody: Access = () => false;

export const staffField: FieldAccess = ({ req }) => roleOf(req.user) !== null;
export const adminField: FieldAccess = ({ req }) => hasRole(req.user, 'admin');

/** Roles allowed to approve, reject, archive, publish, or unpublish content. */
export const canPublish = (req: Pick<PayloadRequest, 'user'>): boolean =>
  hasRole(req.user, 'admin', 'reviewer');
