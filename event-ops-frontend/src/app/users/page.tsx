'use client'
import { useEffect, useState } from 'react'
import { Plus, UserCheck, UserX, Phone, Mail } from 'lucide-react'
import TopBar from '@/components/TopBar'
import Modal from '@/components/Modal'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/context/AuthContext'
import { usersApi, getErrorMessage } from '@/lib/api'
import { useLang } from '@/context/LanguageContext'
import { usePresence } from '@/lib/usePresence'

interface TeamUser {
  user_id: string
  name: string
  email?: string
  role: string
  phone?: string
  avatar?: string
  is_active?: boolean
  created_at?: string
}

const empty = { name: '', email: '', phone: '', password: '', role: 'staff' }

// Role colour by level: Admin (red) > Manager (yellow) > Staff (green).
const roleColor: Record<string, string> = {
  admin:   'var(--accent-red)',
  manager: 'var(--accent-amber)',
  staff:   'var(--accent-green)',
}
const OFFLINE = 'var(--text-muted)'

// Ordering of the "everyone else" section: Staff first, then Manager, then Admin.
const ROLE_RANK: Record<string, number> = { staff: 0, manager: 1, admin: 2 }

type RoleFilter = 'all' | 'staff' | 'manager' | 'admin'

export default function UsersPage() {
  const { user, isManager, isAdmin } = useAuth()
  const { t, tError } = useLang()
  const online = usePresence()
  const [users, setUsers]         = useState<TeamUser[]>([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]           = useState({ ...empty })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')

  // Current user first, then Staff > Manager > Admin (then by name), with the
  // optional role filter applied.
  const visibleUsers = users
    .filter(u => roleFilter === 'all' || u.role === roleFilter)
    .sort((a, b) => {
      const aMe = a.user_id === user?.user_id ? 0 : 1
      const bMe = b.user_id === user?.user_id ? 0 : 1
      if (aMe !== bMe) return aMe - bMe
      const ar = ROLE_RANK[a.role] ?? 99
      const br = ROLE_RANK[b.role] ?? 99
      if (ar !== br) return ar - br
      return a.name.localeCompare(b.name)
    })

  // Everyone can see the presence board. Managers/admins get the full roster
  // (with emails + management); staff get the minimal directory.
  useEffect(() => {
    const load = isManager ? usersApi.getAll() : usersApi.directory()
    load.then(setUsers).finally(() => setLoading(false))
  }, [isManager])

  const roleLabel = (role: string) =>
    role === 'manager' ? t('Manager', 'Quản lý')
    : role === 'admin' ? t('Admin', 'Quản trị viên')
    : t('Staff', 'Nhân viên')

  const handleCreate = async () => {
    if (!form.name || !form.email || !form.phone || !form.password) {
      setError(t('Name, email, phone and password are required', 'Vui lòng nhập tên, email, số điện thoại và mật khẩu')); return
    }
    if (!form.email.includes('@') || form.email.length > 50) {
      setError(t('Email must contain "@" and be at most 50 characters', 'Email phải chứa "@" và không quá 50 ký tự')); return
    }
    if (!/^\d{10}$/.test(form.phone)) {
      setError(t('Phone number must be exactly 10 digits', 'Số điện thoại phải gồm đúng 10 chữ số')); return
    }
    setSaving(true); setError('')
    try {
      const created = await usersApi.create(form)
      setUsers(prev => [...prev, created])
      setShowModal(false); setForm({ ...empty })
    } catch (e) {
      setError(tError(getErrorMessage(e, 'Could not create the member / Không thể tạo thành viên')))
    } finally { setSaving(false) }
  }

  const toggleActive = async (u: TeamUser) => {
    const msg = u.is_active
      ? t(`Deactivate ${u.name}?`, `Vô hiệu hóa ${u.name}?`)
      : t(`Reactivate ${u.name}?`, `Kích hoạt lại ${u.name}?`)
    if (!confirm(msg)) return
    await usersApi.update(u.user_id, { is_active: !u.is_active })
    setUsers(prev => prev.map(x => x.user_id === u.user_id ? { ...x, is_active: !u.is_active } : x))
  }

  const onlineCount = visibleUsers.filter(u => online.has(u.user_id)).length

  const legendItem = (label: string, color: string) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-muted)' }}>
      <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: color }} />
      {label}
    </span>
  )

  return (
    <div>
      <TopBar title="Team" titleVi="Nhân viên" />
      <div style={{ padding: '28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{visibleUsers.length} {t('members', 'thành viên')}</p>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--accent-green)', fontWeight: 600 }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-green)' }} />
              {onlineCount} {t('online', 'trực tuyến')}
            </span>
          </div>
          {isManager && (
            <button onClick={() => setShowModal(true)} style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              background: 'var(--accent-blue)', color: 'white',
              border: 'none', borderRadius: '9px', padding: '9px 18px', fontSize: '13px', fontWeight: 600,
            }}>
              <Plus size={15} /> {t('Add Member', 'Thêm nhân viên')}
            </button>
          )}
        </div>

        {/* Role colour legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px', flexWrap: 'wrap' }}>
          {legendItem(t('Admin', 'Quản trị viên'), roleColor.admin)}
          {legendItem(t('Manager', 'Quản lý'), roleColor.manager)}
          {legendItem(t('Staff', 'Nhân viên'), roleColor.staff)}
          {legendItem(t('Offline', 'Ngoại tuyến'), OFFLINE)}
        </div>

        {/* Role filter */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {([
            ['all', t('All', 'Tất cả')],
            ['staff', t('Staff', 'Nhân viên')],
            ['manager', t('Manager', 'Quản lý')],
            ['admin', t('Admin', 'Quản trị viên')],
          ] as [RoleFilter, string][]).map(([key, lbl]) => {
            const active = roleFilter === key
            return (
              <button key={key} onClick={() => setRoleFilter(key)} style={{
                fontSize: '12px', fontWeight: 600, padding: '6px 13px', borderRadius: '8px',
                background: active ? 'var(--accent-blue)' : 'var(--bg-card)',
                color: active ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
              }}>{lbl}</button>
            )
          })}
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('Loading...', 'Đang tải...')}</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(500px, 1fr))', gap: '8px' }}>
            {visibleUsers.map(u => {
              const isOnline = online.has(u.user_id)
              const isMe = u.user_id === user?.user_id
              // Role colour when online; grey when offline.
              const dColor = isOnline ? (roleColor[u.role] || 'var(--accent-teal)') : OFFLINE
              return (
              <div key={u.user_id} style={{
                background: isMe ? 'rgba(34,197,94,0.06)' : 'var(--bg-card)',
                // The current user's own row glows green so it's easy to spot.
                border: `1px solid ${isMe ? 'var(--accent-green)' : 'var(--border)'}`,
                boxShadow: isMe ? '0 0 0 1px var(--accent-green), 0 0 18px rgba(34,197,94,0.35)' : 'none',
                borderRadius: '10px', padding: '14px 18px',
                display: 'flex', alignItems: 'center', gap: '14px',
                // Only dim genuinely deactivated accounts. The staff directory
                // omits is_active (undefined) — those must not look greyed.
                opacity: u.is_active === false ? 0.5 : 1,
              }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <Avatar src={u.avatar} size={42} radius={10} iconColor={dColor} bg={dColor + '22'} />
                  {/* Online presence dot */}
                  <span style={{
                    position: 'absolute', bottom: '-2px', right: '-2px',
                    width: '12px', height: '12px', borderRadius: '50%',
                    background: isOnline ? 'var(--accent-green)' : OFFLINE,
                    border: '2px solid var(--bg-card)',
                  }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="selectable">{u.name}</span>
                    {isMe && (
                      <span style={{
                        fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em',
                        padding: '2px 7px', borderRadius: '10px',
                        background: 'rgba(34,197,94,0.18)', color: 'var(--accent-green)',
                      }}>{t('You', 'Bạn')}</span>
                    )}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: '2px' }}>
                    {u.email && (
                      <span className="selectable" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        <Mail size={11} /> {u.email}
                      </span>
                    )}
                    {u.phone && (
                      <span className="selectable" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        <Phone size={11} /> {u.phone}
                      </span>
                    )}
                  </div>
                </div>
                <span style={{
                  fontSize: '11px', fontWeight: 600, color: isOnline ? 'var(--accent-green)' : OFFLINE,
                }}>{isOnline ? t('Online', 'Trực tuyến') : t('Offline', 'Ngoại tuyến')}</span>
                <span style={{
                  fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '12px',
                  background: dColor + '22', color: dColor,
                }}>{roleLabel(u.role)}</span>
                {isAdmin && (
                  <span style={{
                    fontSize: '11px', padding: '3px 8px', borderRadius: '12px',
                    background: u.is_active ? '#1a3320' : '#2a2a2a',
                    color: u.is_active ? 'var(--accent-green)' : 'var(--text-muted)',
                  }}>
                    {u.is_active ? t('Active', 'Hoạt động') : t('Inactive', 'Ngừng')}
                  </span>
                )}
                {isAdmin && (
                  <button onClick={() => toggleActive(u)} style={{
                    background: 'none', border: '1px solid var(--border)',
                    borderRadius: '6px', padding: '5px 8px', cursor: 'pointer',
                    color: u.is_active ? 'var(--accent-red)' : 'var(--accent-green)',
                    fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px',
                  }}>
                    {u.is_active
                      ? <><UserX size={12} /> {t('Deactivate', 'Vô hiệu hóa')}</>
                      : <><UserCheck size={12} /> {t('Activate', 'Kích hoạt')}</>}
                  </button>
                )}
              </div>
              )
            })}
          </div>
        )}
      </div>

      {showModal && (
        <Modal title={t('Add Team Member', 'Thêm nhân viên')} onClose={() => { setShowModal(false); setError('') }}>
          {[
            { label: 'Full Name', vi: 'Họ và tên', key: 'name', type: 'text' },
            { label: 'Email',     vi: 'Email',     key: 'email', type: 'email' },
            { label: 'Phone Number', vi: 'Số điện thoại', key: 'phone', type: 'tel' },
            { label: 'Password',  vi: 'Mật khẩu', key: 'password', type: 'password' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {t(f.label, f.vi)}
              </label>
              <input type={f.type} value={form[f.key as keyof typeof empty]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} />
            </div>
          ))}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('Role', 'Vai trò')}
            </label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="staff">{t('Staff', 'Nhân viên')}</option>
              <option value="manager">{t('Manager', 'Quản lý')}</option>
              {/* Only an admin can create another admin */}
              {isAdmin && <option value="admin">{t('Admin', 'Quản trị viên')}</option>}
            </select>
          </div>
          {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowModal(false); setError('') }} style={{
              background: 'var(--bg-hover)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: '8px',
              padding: '9px 18px', fontSize: '13px',
            }}>{t('Cancel', 'Hủy')}</button>
            <button onClick={handleCreate} disabled={saving} style={{
              background: 'var(--accent-blue)', color: 'white',
              border: 'none', borderRadius: '8px',
              padding: '9px 18px', fontSize: '13px', fontWeight: 600,
              opacity: saving ? 0.6 : 1,
            }}>{saving ? t('Adding...', 'Đang thêm...') : t('Add Member', 'Thêm nhân viên')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
