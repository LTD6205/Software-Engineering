'use client'
import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { getErrorMessage } from '@/lib/api'
import { useLang } from '@/context/LanguageContext'
import LangToggle from '@/components/LangToggle'
import { CalendarDays, Lock, Mail, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const { login } = useAuth()
  const { t, tError } = useLang()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleLogin = async () => {
    if (!email || !password) { setError(t('Please enter email and password', 'Vui lòng nhập email và mật khẩu')); return }
    setLoading(true); setError('')
    try {
      await login(email, password)
    } catch (e) {
      setError(tError(getErrorMessage(e, 'Invalid email or password / Email hoặc mật khẩu không đúng')))
    } finally { setLoading(false) }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        width: '100%', maxWidth: '400px',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '16px', padding: '40px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <LangToggle />
        </div>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '48px', height: '48px', borderRadius: '12px',
            background: 'var(--accent-blue)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <CalendarDays size={24} color="white" />
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Event Ops
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {t('Sign in to your account', 'Đăng nhập vào tài khoản')}
          </p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
            {t('Email', 'Email')}
          </label>
          <div style={{ position: 'relative' }}>
            <Mail size={15} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="your@email.com"
              style={{ paddingLeft: '36px' }}
            />
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
            {t('Password', 'Mật khẩu')}
          </label>
          <div style={{ position: 'relative' }}>
            <Lock size={15} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••"
              style={{ paddingLeft: '36px', paddingRight: '40px' }}
            />
            <button
              onClick={() => setShowPass(s => !s)}
              style={{
                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: 'var(--text-muted)', padding: '4px',
              }}>
              {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {error && (
          <div style={{
            background: '#3a1a1a', border: '1px solid var(--accent-red)',
            borderRadius: '8px', padding: '10px 14px',
            fontSize: '13px', color: 'var(--accent-red)', marginBottom: '16px',
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: '100%', background: 'var(--accent-blue)', color: 'white',
            border: 'none', borderRadius: '9px', padding: '12px',
            fontSize: '14px', fontWeight: 700,
            opacity: loading ? 0.6 : 1,
          }}>
          {loading ? t('Signing in...', 'Đang đăng nhập...') : t('Sign In', 'Đăng nhập')}
        </button>

        <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>
          account: {'{role}{id}@eventops.com'}
        </p>
      </div>
    </div>
  )
}