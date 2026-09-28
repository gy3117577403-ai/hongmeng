import { redirect } from 'next/navigation';
import {
  canAccessAppRoute,
  landingRouteForAccess,
} from '@/lib/app-route-access';
import { currentUser } from '@/lib/auth';

export async function requirePageAccess(pathname: string, next = pathname) {
  const user = await requireMobileSession(next);
  if (!canAccessAppRoute(user.access, pathname)) {
    redirect(landingRouteForAccess(user.access));
  }
  return user;
}

/** Mobile QR pages render their own access notice without losing the QR target. */
export async function requireMobileSession(next: string) {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (user.mustChangePassword) {
    redirect(`/change-password?next=${encodeURIComponent(next)}`);
  }
  return user;
}
