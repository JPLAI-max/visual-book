import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from '@/lib/queryClient';
import NotFound from '@/pages/not-found';
import HomePage from '@/pages/home';
import Portal from '@/pages/portal';
import Library from '@/pages/library';
import BookPage from '@/pages/book';
import Watch from '@/pages/watch';
import Admin from '@/pages/admin';
import { SignInPage, SignUpPage } from '@/pages/auth';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#7a2e22',
    colorForeground: '#2a211b',
    colorMutedForeground: '#6a5f55',
    colorDanger: '#a3322b',
    colorBackground: '#f8f4ea',
    colorInput: '#fbf8f1',
    colorInputForeground: '#2a211b',
    colorNeutral: '#8a7f73',
    fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
    borderRadius: '0.6rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#f8f4ea] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#e2d9c8]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: { fontFamily: "'Newsreader', Georgia, serif", fontWeight: 400, fontSize: '1.9rem', color: '#2a211b' },
    headerSubtitle: { color: '#6a5f55' },
    socialButtonsBlockButtonText: { color: '#2a211b' },
    formFieldLabel: { color: '#2a211b' },
    footerActionLink: { color: '#7a2e22' },
    footerActionText: { color: '#6a5f55' },
    dividerText: { color: '#6a5f55' },
    identityPreviewEditButton: { color: '#7a2e22' },
    formFieldSuccessText: { color: '#3d6b4a' },
    alertText: { color: '#a3322b' },
    logoBox: { height: '2.5rem' },
    formButtonPrimary: { backgroundColor: '#2a211b', borderRadius: '999px', textTransform: 'none' as const },
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const id = user?.id ?? null;
      if (prev.current !== undefined && prev.current !== id) qc.clear();
      prev.current = id;
    });
    return unsub;
  }, [addListener, qc]);
  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/user-portal" /></Show>
      <Show when="signed-out"><HomePage /></Show>
    </>
  );
}
function Gate({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to pick up where you left off' } },
        signUp: { start: { title: 'Create your shelf', subtitle: 'Save books and resume anywhere' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/user-portal">{() => <Gate><Portal /></Gate>}</Route>
              <Route path="/library" component={Library} />
              <Route path="/books/:id" component={BookPage} />
              <Route path="/watch/:bookId/:chapterId" component={Watch} />
              <Route path="/admin" component={Admin} />
              <Route path="/admin/:section" component={Admin} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
