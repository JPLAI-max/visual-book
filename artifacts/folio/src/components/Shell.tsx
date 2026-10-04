import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import { basePath } from '@/lib/base';
import { useReader } from '@/lib/use-reader';

export function Shell({ children }: { children: ReactNode }) {
  const { authed, admin } = useReader();
  const { signOut } = useClerk();
  const [loc] = useLocation();
  const link = (href: string, text: string) => (
    <Link href={href} data-testid={`link-nav-${text.toLowerCase()}`}
      className={`relative py-1 text-sm transition-colors hover:text-foreground ${loc.startsWith(href) ? 'text-foreground' : 'text-muted-foreground'}`}>
      {text}
    </Link>
  );
  return (
    <div className="grain min-h-[100dvh]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7">
        <Link href={authed ? '/user-portal' : '/'} className="flex items-center gap-3" data-testid="link-home">
          <img src={`${basePath}/logo.svg`} alt="" className="h-7 w-7" />
          <span className="serif text-2xl tracking-tight">Folio</span>
        </Link>
        <nav className="flex items-center gap-7">
          {authed && link('/library', 'Library')}
          {admin && link('/admin', 'Admin')}
          {authed ? (
            <button className="text-sm text-muted-foreground transition-colors hover:text-foreground" data-testid="button-sign-out"
              onClick={() => signOut({ redirectUrl: basePath || '/' })}>Sign out</button>
          ) : (
            <Link href="/sign-in" className="text-sm text-muted-foreground transition-colors hover:text-foreground" data-testid="link-sign-in">Sign in</Link>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-32">{children}</main>
      <footer className="mx-auto max-w-6xl border-t px-6 py-10 text-xs text-muted-foreground">
        Folio. Public domain books, seen slowly.
      </footer>
    </div>
  );
}
