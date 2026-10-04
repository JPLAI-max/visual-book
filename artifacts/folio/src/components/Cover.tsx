import { useState } from 'react';
export function Cover({ src, title, className = '' }: { src?: string; title: string; className?: string }) {
  const [bad, setBad] = useState(false);
  return (
    <div className={`relative aspect-[2/3] overflow-hidden rounded-[3px] bg-muted ${className}`}>
      {src && !bad ? (
        <img src={src} alt={`Cover of ${title}`} loading="lazy" onError={() => setBad(true)} className="h-full w-full object-cover" />
      ) : (
        <div className="serif flex h-full items-center justify-center p-4 text-center text-lg text-muted-foreground">{title}</div>
      )}
    </div>
  );
}
