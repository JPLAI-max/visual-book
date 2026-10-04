import { Link } from 'wouter';
import { Shell } from '@/components/Shell';
import { Message } from '@/components/States';
export default function NotFound() {
  return <Shell><Message title="This page is not in the book" body="The address may be mistyped or the page may have moved." action={<Link href="/" className="btn" data-testid="link-back-home">Return to the catalog</Link>} /></Shell>;
}
