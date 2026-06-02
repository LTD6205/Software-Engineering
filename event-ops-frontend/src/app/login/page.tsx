'use client'
import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { getErrorMessage } from '@/lib/api'
import { useLang } from '@/context/LanguageContext'
import LangToggle from '@/components/LangToggle'
import { CalendarDays, Lock, Mail, Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react'

export default function LoginPage() {
  const { login } = useAuth()
  const { t, tError } = useLang()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [focused, setFocused]   = useState<'email' | 'password' | null>(null)
  const [btnHover, setBtnHover] = useState(false)

  const handleLogin = async () => {
    if (!email || !password) { setError(t('Please enter email and password', 'Vui lòng nhập email và mật khẩu')); return }
    setLoading(true); setError('')
    try {
      await login(email, password)
    } catch (e) {
      setError(tError(getErrorMessage(e, 'Invalid email or password / Email hoặc mật khẩu không đúng')))
    } finally { setLoading(false) }
  }

  // A field "shell" that owns the border + focus ring; the input inside is
  // borderless and transparent so the whole row highlights on focus.
  const shell = (name: 'email' | 'password'): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '10px',
    background: 'var(--bg-secondary)',
    border: `1px solid ${focused === name ? 'var(--accent-blue)' : 'var(--border)'}`,
    borderRadius: '11px', padding: '0 12px',
    boxShadow: focused === name ? '0 0 0 3px rgba(59,130,246,0.16)' : 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  })
  const bareInput: React.CSSProperties = {
    flex: 1, width: 'auto', background: 'transparent', border: 'none',
    boxShadow: 'none', padding: '13px 0', fontSize: '14px',
  }
  const iconColor = (name: 'email' | 'password') => focused === name ? 'var(--accent-blue)' : 'var(--text-muted)'

  return (
    <div style={{
      minHeight: '100vh',
      // Ambient brand glow over the dark base.
      background:
        'radial-gradient(1100px 520px at 50% -12%, rgba(59,130,246,0.20), transparent 60%),' +
        'radial-gradient(820px 460px at 105% 112%, rgba(139,92,246,0.16), transparent 55%),' +
        'var(--bg-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{ width: '100%', maxWidth: '410px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
          <LangToggle />
        </div>

        <div style={{
          background: 'linear-gradient(180deg, rgba(28,35,51,0.92), rgba(22,27,39,0.94))',
          border: '1px solid var(--border-light)',
          borderRadius: '20px', padding: '40px 36px',
          boxShadow: '0 28px 70px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(8px)',
        }}>
          {/* Brand */}
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <div style={{
              width: '60px', height: '60px', borderRadius: '16px',
              background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 18px',
              boxShadow: '0 10px 28px rgba(59,130,246,0.45)',
            }}>
              <CalendarDays size={30} color="white" />
            </div>
            <h1 style={{ fontSize: '25px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '6px' }}>
              Event Ops
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {t('Plan events, assign tasks, hit every deadline.', 'Lập kế hoạch sự kiện, giao việc, không lỡ hạn nào.')}
            </p>
          </div>

          {/* Email */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '7px' }}>
              {t('Email', 'Email')}
            </label>
            <div style={shell('email')}>
              <Mail size={16} color={iconColor('email')} style={{ flexShrink: 0, transition: 'color 0.15s' }} />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onFocus={() => setFocused('email')}
                onBlur={() => setFocused(null)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="your@email.com"
                style={bareInput}
              />
            </div>
          </div>

          {/* Password */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '7px' }}>
              {t('Password', 'Mật khẩu')}
            </label>
            <div style={shell('password')}>
              <Lock size={16} color={iconColor('password')} style={{ flexShrink: 0, transition: 'color 0.15s' }} />
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
                style={bareInput}
              />
              <button
                type="button"
                onClick={() => setShowPass(s => !s)}
                title={showPass ? t('Hide password', 'Ẩn mật khẩu') : t('Show password', 'Hiện mật khẩu')}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '4px', display: 'flex', flexShrink: 0 }}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.5)',
              borderRadius: '10px', padding: '10px 14px',
              fontSize: '13px', color: '#fca5a5', marginBottom: '18px',
            }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              width: '100%', color: 'white',
              background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
              border: 'none', borderRadius: '11px', padding: '13px',
              fontSize: '14px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              opacity: loading ? 0.7 : 1,
              transform: btnHover && !loading ? 'translateY(-1px)' : 'none',
              boxShadow: btnHover && !loading ? '0 10px 26px rgba(59,130,246,0.4)' : '0 6px 18px rgba(59,130,246,0.25)',
              transition: 'transform 0.15s, box-shadow 0.15s, opacity 0.15s',
            }}>
            {loading ? t('Signing in...', 'Đang đăng nhập...') : t('Sign In', 'Đăng nhập')}
            {!loading && <ArrowRight size={16} />}
          </button>
        </div>

        {/* Demo account hint */}
        <p className="selectable" style={{
          fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '18px', lineHeight: 1.6,
        }}>
          {t('Demo account', 'Tài khoản demo')}:{' '}
          <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{'{role}{id}@eventops.com'}</span>
        </p>
      </div>
    </div>
  )
}
