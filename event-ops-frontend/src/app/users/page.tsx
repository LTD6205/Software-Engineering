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

const empty = { name: '', email: '', password: '', role: 'staff' }

// Role colour by level: Admin (red) > Manager (yellow) > Staff (green).
const roleColor: Record<string, string> = {
  admin:   'var(--accent-red)',
  manager: 'var(--accent-amber)',
  staff:   'var(--accent-green)',
}
const OFFLINE = 'var(--text-muted)'

export default function UsersPage() {
  const { isManager, isAdmin } = useAuth()
  const { t, tError } = useLang()
  const online = usePresence()
  const [users, setUsers]         = useState<TeamUser[]>([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]           = useState({ ...empty })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

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
    if (!form.name || !form.email || !form.password) {
      setError(t('Name, email and password are required', 'Vui lòng nhập tên, email và mật khẩu')); return
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

  const onlineCount = users.filter(u => online.has(u.user_id)).length

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
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{users.length} {t('members', 'thành viên')}</p>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {legendItem(t('Admin', 'Quản trị viên'), roleColor.admin)}
          {legendItem(t('Manager', 'Quản lý'), roleColor.manager)}
          {legendItem(t('Staff', 'Nhân viên'), roleColor.staff)}
          {legendItem(t('Offline', 'Ngoại tuyến'), OFFLINE)}
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('Loading...', 'Đang tải...')}</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(500px, 1fr))', gap: '8px' }}>
            {users.map(u => {
              const isOnline = online.has(u.user_id)
              // Role colour when online; grey when offline.
              const dColor = isOnline ? (roleColor[u.role] || 'var(--accent-teal)') : OFFLINE
              return (
              <div key={u.user_id} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
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
                  <p className="selectable" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{u.name}</p>
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
                {isManager && (
                  <span style={{
                    fontSize: '11px', padding: '3px 8px', borderRadius: '12px',
                    background: u.is_active ? '#1a3320' : '#2a2a2a',
                    color: u.is_active ? 'var(--accent-green)' : 'var(--text-muted)',
                  }}>
                    {u.is_active ? t('Active', 'Hoạt động') : t('Inactive', 'Ngừng')}
                  </span>
                )}
                {isManager && (
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
