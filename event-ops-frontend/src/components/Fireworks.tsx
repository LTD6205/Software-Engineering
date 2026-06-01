'use client'
import { useEffect, useRef } from 'react'

const COLORS = ['#fbbf24', '#3b82f6', '#22c55e', '#ef4444', '#8b5cf6', '#14b8a6', '#ffffff']

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; color: string
}

/** A short, self-contained canvas fireworks burst. Calls onDone when finished. */
export default function Fireworks({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    let particles: Particle[] = []
    const burst = (x: number, y: number) => {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]
      const n = 44
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n
        const speed = 2 + Math.random() * 4
        particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, color })
      }
    }

    // Several bursts across the upper area over ~1.3s.
    const timers = [0, 250, 500, 800, 1100, 1300].map(delay =>
      setTimeout(
        () => burst(canvas.width * (0.15 + Math.random() * 0.7), canvas.height * (0.15 + Math.random() * 0.45)),
        delay,
      ),
    )

    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= 0.012
        ctx.globalAlpha = Math.max(0, p.life)
        ctx.fillStyle = p.color
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill()
      }
      particles = particles.filter(p => p.life > 0)
      if (now - start < 2900 || particles.length > 0) {
        raf = requestAnimationFrame(tick)
      } else {
        onDone()
      }
    }
    raf = requestAnimationFrame(tick)

    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout) }
  }, [onDone])

  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }} />
}
