import { SignIn, SignUp } from '@clerk/react';
import { Link } from 'wouter';
import { basePath } from '@/lib/base';
function Frame({ children, line }: { children: React.ReactNode; line: string }) {
  return (
    <div className="grain grid min-h-[100dvh] md:grid-cols-[1fr_1.1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[hsl(24_22%_12%)] p-14 text-[hsl(40_33%_92%)] md:flex">
        <img src={`${basePath}/scenes/arctic.svg`} alt="" className="kb absolute inset-0 h-full w-full object-cover opacity-40" />
        <Link href="/" className="serif relative text-3xl">Folio</Link>
        <p className="serif relative max-w-sm text-4xl leading-tight">{line}</p>
      </div>
      <div className="flex items-center justify-center px-4 py-12">{children}</div>
    </div>
  );
}
export function SignInPage() {
  return <Frame line="Pick up exactly where the story left you."><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></Frame>;
}
export function SignUpPage() {
  return <Frame line="A quiet shelf of your own."><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></Frame>;
}
