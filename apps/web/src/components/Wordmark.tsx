import Link from 'next/link'

export function Wordmark({
  href = '/',
  size = 'md',
}: {
  href?: string | null
  size?: 'sm' | 'md' | 'lg' | 'hero'
}) {
  const scale = {
    sm: 'text-[22px] tracking-[0.18em]',
    md: 'text-[28px] tracking-[0.22em]',
    lg: 'text-[40px] tracking-[0.2em]',
    hero: 'text-[56px] sm:text-[72px] tracking-[0.18em]',
  }[size]

  const inner = (
    <span className={`font-display font-semibold uppercase text-[#F3EDE4] ${scale} leading-none`}>
      Memories<span className="text-ev-crimson">.</span>
    </span>
  )

  if (!href) return inner
  return (
    <Link href={href} className="inline-block no-underline">
      {inner}
    </Link>
  )
}
