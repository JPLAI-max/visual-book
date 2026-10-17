import { motion } from 'framer-motion';
const B = import.meta.env.BASE_URL;
const E = [0.2, 0.8, 0.2, 1] as const;
const exit = { opacity: 0, transition: { duration: 0.35 } };

function Logo({ size }: { size: string }) {
  return <img src={B + 'logo.svg'} style={{ width: size, height: size }} alt="" />;
}

function Caption({ eyebrow, text, delay, dark = false, pos }: { eyebrow: string; text: string; delay: number; dark?: boolean; pos: React.CSSProperties }) {
  return (
    <motion.div className="absolute z-30" style={{ ...pos, maxWidth: '40vw' }}
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.7, ease: E }}>
      <div className="rounded-2xl px-[3vmin] py-[2.4vmin]" style={{ background: dark ? 'hsl(24 22% 12% / .9)' : 'hsl(40 33% 96% / .94)', boxShadow: '0 30px 60px -30px hsl(24 30% 20% / .55)' }}>
        <div className="eyebrow" style={{ color: dark ? 'hsl(36 22% 75%)' : undefined }}>{eyebrow}</div>
        <div className="serif" style={{ fontSize: '5.2vmin', lineHeight: 1.05, marginTop: '1vmin', color: dark ? 'var(--bg)' : 'var(--fg)' }}>{text}</div>
      </div>
    </motion.div>
  );
}

export function IntroScene() {
  return (
    <motion.div className="absolute inset-0 flex items-center justify-center" exit={{ opacity: 0, scale: 1.08, transition: { duration: 0.45 } }}>
      <motion.div className="absolute rounded-full" style={{ width: '70vmin', height: '70vmin', border: '1px solid hsl(8 52% 32% / .25)' }}
        initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1.15, opacity: 1 }} transition={{ duration: 2.4, ease: E }} />
      <div className="flex items-center gap-[3vmin]">
        <motion.div initial={{ scale: 0, rotate: -14 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}>
          <Logo size="16vmin" />
        </motion.div>
        <div style={{ overflow: 'hidden', paddingBottom: '2vmin' }}>
          <motion.div className="serif" style={{ fontSize: '22vmin', lineHeight: 1 }}
            initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ delay: 0.45, duration: 0.8, ease: E }}>Folio</motion.div>
        </div>
      </div>
      <motion.div className="eyebrow absolute" style={{ bottom: '24vh' }}
        initial={{ opacity: 0, letterSpacing: '0.6em' }} animate={{ opacity: 1, letterSpacing: '0.22em' }} transition={{ delay: 1.0, duration: 0.9, ease: E }}>
        Books, seen slowly
      </motion.div>
    </motion.div>
  );
}

// Real capture of / (1920x1986). Camera: push on headline -> scroll down to the shelf.
export function HomeScene() {
  return (
    <motion.div className="absolute inset-0 overflow-hidden" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: E }} exit={exit}>
      <motion.img src={B + 'captures/home.jpg'} alt="" className="absolute left-0 top-0" style={{ width: '100vw', transformOrigin: '50% 0%' }}
        initial={{ scale: 1.7, x: '0vw', y: '-8vw' }}
        animate={{ scale: [1.7, 1.7, 1.15, 1.15], x: ['0vw', '0vw', '0vw', '-6vw'], y: ['-8vw', '-8vw', '-36vw', '-44vw'] }}
        transition={{ duration: 4, times: [0, 0.3, 0.75, 1], ease: 'easeInOut' }} />
      <Caption eyebrow="Search first" text="Find a book you love." delay={0.4} pos={{ left: '5vw', bottom: '9vh' }} />
      <motion.div className="absolute z-30" style={{ right: '5vw', top: '8vh' }} initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.3, duration: 0.6, ease: E }}>
        <div className="eyebrow rounded-full px-[2.4vmin] py-[1.4vmin]" style={{ background: 'var(--fg)', color: 'var(--bg)' }}>Visual book editions</div>
      </motion.div>
    </motion.div>
  );
}

// Real capture of /books/1 (1920x1119). Close on title -> slide down to rights text and chapters.
export function BookScene() {
  return (
    <motion.div className="absolute inset-0 overflow-hidden" initial={{ clipPath: 'inset(0 0 0 100%)' }} animate={{ clipPath: 'inset(0 0 0 0%)' }} transition={{ duration: 0.6, ease: E }} exit={exit} style={{ background: 'var(--bg)' }}>
      <motion.img src={B + 'captures/frankenstein.jpg'} alt="" className="absolute left-0 top-0" style={{ width: '100vw', transformOrigin: '0 0' }}
        initial={{ scale: 2.1, x: '-70vw', y: '-6vw' }}
        animate={{ scale: [2.1, 2.1, 1.9, 1.35], x: ['-70vw', '-70vw', '-66vw', '-22vw'], y: ['-6vw', '-6vw', '-28vw', '-26vw'] }}
        transition={{ duration: 3.3, times: [0, 0.2, 0.55, 1], ease: 'easeInOut' }} />
      <Caption eyebrow="Frankenstein · Mary Shelley" text="Chapter by chapter." delay={0.5} dark pos={{ left: '5vw', bottom: '9vh' }} />
    </motion.div>
  );
}

// Real capture of /watch/1/4 (1920x1080). Pull from full player into caption + controls.
export function PlayerScene() {
  return (
    <motion.div className="absolute inset-0 overflow-hidden" style={{ background: 'var(--fg)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
      <motion.img src={B + 'captures/player.jpg'} alt="" className="absolute left-0 top-0" style={{ width: '100vw', transformOrigin: '50% 50%', borderRadius: '1vmin' }}
        initial={{ scale: 1.25, y: '4vh' }}
        animate={{ scale: [1.25, 1.75, 1.75], y: ['4vh', '-4vh', '-6vh'], x: ['0vw', '0vw', '1vw'] }}
        transition={{ duration: 3.4, times: [0, 0.55, 1], ease: 'easeInOut' }} />
      <Caption eyebrow="Synchronized captions" text="Stop whenever you like." delay={0.5} pos={{ right: '5vw', top: '8vh' }} />
      <motion.div className="absolute z-30 serif italic" style={{ left: '5vw', bottom: '8vh', fontSize: '3.4vmin', color: 'var(--bg)', background: 'hsl(24 22% 12% / .85)', padding: '1.2vmin 2.4vmin', borderRadius: '1vmin' }}
        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.7, duration: 0.6, ease: E }}>
        Folio remembers the exact second.
      </motion.div>
    </motion.div>
  );
}

export function OutroScene() {
  return (
    <motion.div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'var(--primary)', color: 'var(--bg)' }}
      initial={{ clipPath: 'circle(0% at 50% 50%)' }} animate={{ clipPath: 'circle(80% at 50% 50%)' }} transition={{ duration: 0.6, ease: E }}>
      <motion.div className="flex items-center gap-[3vmin]" initial={{ scale: 1.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2, duration: 0.8, ease: E }}>
        <Logo size="13vmin" />
        <div className="serif" style={{ fontSize: '19vmin', lineHeight: 1 }}>Folio</div>
      </motion.div>
      <motion.div className="serif italic" style={{ fontSize: '4.6vmin', marginTop: '2.5vmin' }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.6 }}>
        Public domain books, seen slowly.
      </motion.div>
      <motion.div className="absolute text-center" style={{ bottom: '5vh', fontSize: '1.6vmin', maxWidth: '72vw', opacity: 0.8, lineHeight: 1.5 }} initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} transition={{ delay: 0.9, duration: 0.5 }}>
        Frankenstein rights: public domain — Original work and specified historical English source edition are public domain in the United States. Review territory and translation before broader publication.
      </motion.div>
    </motion.div>
  );
}
