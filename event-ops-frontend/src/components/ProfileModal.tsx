'use client'
import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import Modal from './Modal'
import Avatar from './Avatar'
import { useAuth } from '@/context/AuthContext'
import { useLang } from '@/context/LanguageContext'
import api, { usersApi, getErrorMessage } from '@/lib/api'

// Downscale an uploaded image to a small square JPEG data URL so it stays
// lightweight in the database and in API responses.
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode failed'))
      img.onload = () => {
        const max = 256
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no canvas'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, updateUser } = useAuth()
  const { t, tError } = useLang()
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName]         = useState(user?.name ?? '')
  const [email, setEmail]       = useState(user?.email ?? '')
  const [phone, setPhone]       = useState(user?.phone ?? '')
  const [avatar, setAvatar]     = useState<string | undefined>(user?.avatar)
  const [newPassword, setNewPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  // Snapshot of the loaded values, to detect unsaved edits.
  const [initial, setInitial] = useState({
    name: user?.name ?? '', email: user?.email ?? '',
    phone: user?.phone ?? '', avatar: user?.avatar as string | undefined,
  })

  // Load the latest profile when the modal opens so the current phone/email/
  // avatar always show, even if the cached session is older.
  useEffect(() => {
    let active = true
    api.get('/auth/me').then((r) => {
      if (!active || !r.data) return
      const u = r.data
      setName(u.name ?? '')
      setEmail(u.email ?? '')
      setPhone(u.phone ?? '')
      setAvatar(u.avatar || undefined)
      setInitial({ name: u.name ?? '', email: u.email ?? '', phone: u.phone ?? '', avatar: u.avatar || undefined })
      updateUser({ name: u.name, email: u.email, phone: u.phone, avatar: u.avatar })
    }).catch(() => {})
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty =
    name !== initial.name ||
    email !== initial.email ||
    phone !== initial.phone ||
    avatar !== initial.avatar ||
    newPassword.length > 0

  // Close attempt (X / outside / Cancel): confirm if there are unsaved edits.
  const attemptClose = () => {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError(t('Image is too large (max 5MB)', 'Ảnh quá lớn (tối đa 5MB)'))
      return
    }
    try {
      setAvatar(await fileToAvatar(file))
      setError('')
    } catch {
      setError(t('Could not read that image', 'Không thể đọc ảnh đó'))
    }
  }

  const save = async () => {
    if (!name || !email || !phone) {
      setError(t('Name, email and phone are required', 'Vui lòng nhập tên, email và số điện thoại'))
      return
    }
    if (!email.includes('@') || email.length > 50) {
      setError(t('Email must contain "@" and be at most 50 characters', 'Email phải chứa "@" và không quá 50 ký tự'))
      return
    }
    if (!/^\d{10}$/.test(phone)) {
      setError(t('Phone number must be exactly 10 digits', 'Số điện thoại phải gồm đúng 10 chữ số'))
      return
    }
    if (!currentPassword) {
      setError(t('Enter your current password to save changes', 'Nhập mật khẩu hiện tại để lưu thay đổi'))
      return
    }
    setSaving(true); setError('')
    try {
      const updated = await usersApi.updateProfile({
        current_password: currentPassword,
        name, email, phone, avatar,
        ...(newPassword ? { new_password: newPassword } : {}),
      })
      updateUser({
        name: updated.name, email: updated.email,
        phone: updated.phone, avatar: updated.avatar,
      })
      onClose()
    } catch (e) {
      setError(tError(getErrorMessage(e, 'Could not update profile / Không thể cập nhật hồ sơ')))
    } finally { setSaving(false) }
  }

  const label = (en: string, vi: string) => (
    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
      {t(en, vi)}
    </label>
  )

  return (
    <>
      <Modal title={t('My Profile', 'Hồ sơ của tôi')} onClose={attemptClose}>
        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
          <Avatar src={avatar} size={64} radius={14} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button onClick={() => fileRef.current?.click()} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'var(--bg-hover)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: '8px',
              padding: '7px 12px', fontSize: '12px', fontWeight: 600,
            }}>
              <Upload size={13} /> {t('Upload photo', 'Tải ảnh lên')}
            </button>
            {avatar && (
              <button onClick={() => setAvatar(undefined)} style={{
                background: 'none', border: 'none', color: 'var(--accent-red)',
                fontSize: '11px', textAlign: 'left',
              }}>
                {t('Remove photo', 'Xóa ảnh')}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} style={{ display: 'none' }} />
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          {label('Full Name', 'Họ và tên')}
          <input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div style={{ marginBottom: '14px' }}>
          {label('Email', 'Email')}
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div style={{ marginBottom: '14px' }}>
          {label('Phone Number', 'Số điện thoại')}
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('10 digits', '10 chữ số')} />
        </div>
        <div style={{ marginBottom: '18px' }}>
          {label('New Password', 'Mật khẩu mới')}
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
            placeholder={t('Leave blank to keep current', 'Để trống nếu giữ nguyên')} />
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginBottom: '16px' }}>
          {label('Current Password (required to save)', 'Mật khẩu hiện tại (bắt buộc để lưu)')}
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
            placeholder="••••••••" />
        </div>

        {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={attemptClose} style={{
            background: 'var(--bg-hover)', color: 'var(--text-secondary)',
            border: '1px solid var(--border)', borderRadius: '8px',
            padding: '9px 18px', fontSize: '13px',
          }}>{t('Cancel', 'Hủy')}</button>
          <button onClick={save} disabled={saving} style={{
            background: 'var(--accent-blue)', color: 'white',
            border: 'none', borderRadius: '8px',
            padding: '9px 18px', fontSize: '13px', fontWeight: 600,
            opacity: saving ? 0.6 : 1,
          }}>{saving ? t('Saving...', 'Đang lưu...') : t('Save Changes', 'Lưu thay đổi')}</button>
        </div>
      </Modal>

      {/* Unsaved-changes confirmation */}
      {confirmClose && (
        <div
          onClick={() => setConfirmClose(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
          }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-light)',
            borderRadius: '14px', width: '100%', maxWidth: '380px', padding: '24px',
          }}>
            <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
              {t('Unsaved changes', 'Thay đổi chưa lưu')}
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '20px' }}>
              {t('You have unsaved changes. Keep editing or discard them?',
                 'Bạn có thay đổi chưa lưu. Tiếp tục chỉnh sửa hay hủy bỏ?')}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmClose(false)} style={{
                background: 'var(--accent-blue)', color: 'white',
                border: 'none', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: 600,
              }}>{t('Keep editing', 'Tiếp tục chỉnh sửa')}</button>
              <button onClick={() => { setConfirmClose(false); onClose() }} style={{
                background: 'var(--bg-hover)', color: 'var(--accent-red)',
                border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: 600,
              }}>{t('Discard changes', 'Hủy thay đổi')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
