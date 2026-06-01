'use client'
import { User as UserIcon } from 'lucide-react'

interface Props {
  src?: string | null
  size?: number
  radius?: number
  iconColor?: string
  bg?: string
}

/** Shows the user's avatar image, or a default human icon when none is set. */
export default function Avatar({
  src,
  size = 38,
  radius = 10,
  iconColor = 'var(--text-secondary)',
  bg = 'var(--bg-hover)',
}: Props) {
  if (src) {
    // Avatar is a base64 data URL stored on the user; next/image isn't suitable
    // for data URLs here, so a plain img is intentional.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', display: 'block' }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <UserIcon size={Math.round(size * 0.55)} color={iconColor} />
    </div>
  )
}
