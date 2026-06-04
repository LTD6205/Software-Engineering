'use client'
import { useEffect, useState } from 'react'
import { Plus, UserCheck, UserX, Phone, Mail, ArrowRightLeft, Check, X } from 'lucide-react'
import TopBar from '@/components/TopBar'
import Modal from '@/components/Modal'
import Avatar from '@/components/Avatar'
import Dropdown from '@/components/Dropdown'
import { useAuth } from '@/context/AuthContext'
import { usersApi, getErrorMessage } from '@/lib/api'
import { useLang } from '@/context/LanguageContext'
import { usePresence } from '@/lib/usePresence'
import { ROLE_COLOR, roleLabelOf } from '@/lib/roles'

interface TeamUser {
  user_id: string
  name: string
  email?: string
  role: string
  phone?: string
  avatar?: string
  manager_id?: string | null
  pending_manager_id?: string | null
  is_active?: boolean
  created_at?: string
}

interface ReassignRequest {
  user_id: string
  name: string
  email?: string
  avatar?: string
  current_manager_id?: string | null
  current_manager_name?: string | null
}

const empty = { name: '', email: '', phone: '', password: '', role: 'staff' }

// Role colours come from the shared source of truth (@/lib/roles):
// Admin (red) > Organizer (purple) > Manager (amber) > Staff (green).
const roleColor = ROLE_COLOR
const OFFLINE = 'var(--text-muted)'

// Ordering: Staff first, then Manager, Organizer, then Admin.
const ROLE_RANK: Record<string, number> = { staff: 0, manager: 1, organizer: 2, admin: 3 }

type RoleFilter = 'all' | 'myteam' | 'staff' | 'manager' | 'organizer' | 'admin'

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

  // Reassignment workflow state.
  const [requests, setRequests]     = useState<ReassignRequest[]>([])
  const [reassigning, setReassigning] = useState<TeamUser | null>(null)
  const [targetMgr, setTargetMgr]   = useState('')
  const [reErr, setReErr]           = useState('')
  const [reSaving, setReSaving]     = useState(false)

  // Only managers and admins get the full roster (GET /users is manager/admin
  // only on the backend). Organizers and staff see the minimal directory — an
  // organizer calling getAll() would just 403, leaving a misleading empty view.
  const canSeeRoster = isManager
  // A plain manager (not admin/organizer) can filter down to just their own
  // team to reassign members quickly.
  const isPlainManager = user?.role === 'manager'
  const isStaff = user?.role === 'staff'
  // For staff, find their own manager so "My Team" can show everyone who reports
  // to that same manager.
  const myManagerId = isStaff
    ? users.find(u => u.user_id === user?.user_id)?.manager_id ?? null
    : null
  // Show the "My Team" filter to a manager (their staff) or to a staff member
  // who has a manager (their teammates).
  const showMyTeam = isPlainManager || (isStaff && !!myManagerId)

  // Current user first, then Staff > Manager > Admin (then by name), with the
  // optional role filter applied.
  const visibleUsers = users
    .filter(u => {
      if (roleFilter === 'all') return true
      if (roleFilter === 'myteam') {
        // Manager: the staff that report to me.
        if (isPlainManager) return u.role === 'staff' && u.manager_id === user?.user_id
        // Staff: my manager + everyone who reports to the same manager.
        if (isStaff) return u.user_id === myManagerId || (!!u.manager_id && u.manager_id === myManagerId)
        return false
      }
      return u.role === roleFilter
    })
    .sort((a, b) => {
      const aMe = a.user_id === user?.user_id ? 0 : 1
      const bMe = b.user_id === user?.user_id ? 0 : 1
      if (aMe !== bMe) return aMe - bMe
      const ar = ROLE_RANK[a.role] ?? 99
      const br = ROLE_RANK[b.role] ?? 99
      if (ar !== br) return ar - br
      return a.name.localeCompare(b.name)
    })

  // Everyone can see the presence board. Managers/organizers/admins get the
  // full roster (with emails + management); staff get the minimal directory.
  useEffect(() => {
    const load = canSeeRoster ? usersApi.getAll() : usersApi.directory()
    // Swallow errors (e.g. a 401 before the auth guard redirects to login) so
    // they don't surface as unhandled promise rejections.
    load.then(setUsers).catch(() => {}).finally(() => setLoading(false))
    // Only a manager can be the target of a reassignment request.
    if (isManager) usersApi.reassignRequests().then(setRequests).catch(() => {})
  }, [canSeeRoster, isManager])

  // Map of manager id → name, for showing which manager a staff reports to.
  const managerName: Record<string, string> = {}
  for (const u of users) if (u.role === 'manager') managerName[u.user_id] = u.name
  // Managers the current user can hand a staff member off to (everyone but self).
  const otherManagers = users.filter(u => u.role === 'manager' && u.user_id !== user?.user_id)

  const roleLabel = (role: string) => roleLabelOf(role, t)

  // Open the reassign picker for one of my staff members.
  const openReassign = (u: TeamUser) => {
    setReassigning(u); setTargetMgr(''); setReErr('')
  }

  const submitReassign = async () => {
    if (!reassigning || !targetMgr) {
      setReErr(t('Select a manager', 'Chọn một quản lý')); return
    }
    setReSaving(true); setReErr('')
    try {
      const updated = await usersApi.reassign(reassigning.user_id, targetMgr)
      setUsers(prev => prev.map(x => x.user_id === updated.user_id ? { ...x, ...updated } : x))
      setReassigning(null)
    } catch (e) {
      setReErr(tError(getErrorMessage(e, 'Could not send the request / Không thể gửi yêu cầu')))
    } finally { setReSaving(false) }
  }

  // Withdraw a pending request I sent, before the target manager acts.
  const cancelReassign = async (staffId: string) => {
    try {
      await usersApi.cancelReassign(staffId)
      setUsers(prev => prev.map(x => x.user_id === staffId ? { ...x, pending_manager_id: null } : x))
    } catch { /* leave the pending state as-is if the call fails */ }
  }

  // Accept / reject an incoming request (I am the proposed new manager).
  const acceptRequest = async (staffId: string) => {
    const updated = await usersApi.acceptReassign(staffId)
    setRequests(prev => prev.filter(r => r.user_id !== staffId))
    setUsers(prev => prev.map(x => x.user_id === staffId ? { ...x, ...updated } : x))
  }
  const rejectRequest = async (staffId: string) => {
    await usersApi.rejectReassign(staffId)
    setRequests(prev => prev.filter(r => r.user_id !== staffId))
    setUsers(prev => prev.map(x => x.user_id === staffId ? { ...x, pending_manager_id: null } : x))
  }

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
          {legendItem(t('Organizer', 'Quản lý sự kiện'), roleColor.organizer)}
          {legendItem(t('Manager', 'Quản lý'), roleColor.manager)}
          {legendItem(t('Staff', 'Nhân viên'), roleColor.staff)}
          {legendItem(t('Offline', 'Ngoại tuyến'), OFFLINE)}
        </div>

        {/* Role filter */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {([
            ['all', t('All', 'Tất cả')],
            // "My Team": a manager's own staff, or a staff member's teammates.
            ...(showMyTeam ? [['myteam', t('My Team', 'Đội của tôi')] as [RoleFilter, string]] : []),
            // Only show a role filter when that role actually appears in this
            // viewer's roster — a manager who only sees their staff isn't offered
            // Organizer/Admin filters that would match nobody.
            ...(([
              ['staff', t('Staff', 'Nhân viên')],
              ['manager', t('Manager', 'Quản lý')],
              ['organizer', t('Organizer', 'Quản lý sự kiện')],
              ['admin', t('Admin', 'Quản trị viên')],
            ] as [RoleFilter, string][]).filter(([key]) => users.some(u => u.role === key))),
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

        {/* Incoming reassignment requests — I am the proposed new manager. */}
        {requests.length > 0 && (
          <div style={{
            background: 'rgba(59,130,246,0.06)', border: '1px solid var(--accent-blue)',
            borderRadius: '12px', padding: '16px 18px', marginBottom: '20px',
          }}>
            <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-blue)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}>
              <ArrowRightLeft size={15} /> {t('Reassignment requests', 'Yêu cầu chuyển nhân viên')} ({requests.length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {requests.map(r => (
                <div key={r.user_id} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: '9px', padding: '10px 14px',
                }}>
                  <Avatar src={r.avatar} size={34} radius={9} iconColor="var(--accent-blue)" bg="rgba(59,130,246,0.13)" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="selectable" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {t('Currently with', 'Hiện thuộc')} {r.current_manager_name || t('no manager', 'chưa có quản lý')}
                    </p>
                  </div>
                  <button onClick={() => acceptRequest(r.user_id)} style={{
                    display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600,
                    background: 'var(--accent-green)', color: 'white', border: 'none',
                    borderRadius: '7px', padding: '7px 13px', cursor: 'pointer',
                  }}><Check size={13} /> {t('Accept', 'Chấp nhận')}</button>
                  <button onClick={() => rejectRequest(r.user_id)} style={{
                    display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600,
                    background: 'var(--bg-hover)', color: 'var(--accent-red)', border: '1px solid var(--border)',
                    borderRadius: '7px', padding: '7px 13px', cursor: 'pointer',
                  }}><X size={13} /> {t('Reject', 'Từ chối')}</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('Loading...', 'Đang tải...')}</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(500px, 100%), 1fr))', gap: '8px' }}>
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
                  {/* For staff (roster view): which manager they report to, plus
                      any pending reassignment. */}
                  {canSeeRoster && u.role === 'staff' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: '4px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {t('Team', 'Đội')}: <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                          {u.manager_id ? (managerName[u.manager_id] || t('Manager', 'Quản lý')) : t('Unassigned', 'Chưa phân')}
                        </span>
                      </span>
                      {u.pending_manager_id && (
                        <span style={{
                          fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px',
                          background: 'rgba(245,158,11,0.16)', color: 'var(--accent-amber)',
                          display: 'flex', alignItems: 'center', gap: '4px',
                        }}>
                          <ArrowRightLeft size={10} /> {t('Pending', 'Đang chờ')} → {managerName[u.pending_manager_id] || '...'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {/* Owner manager can hand this staff member to another manager. */}
                {isManager && u.role === 'staff' && u.manager_id === user?.user_id && !u.pending_manager_id && (
                  <button onClick={() => openReassign(u)} style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: '6px',
                    padding: '5px 9px', cursor: 'pointer', color: 'var(--accent-blue)',
                    fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
                  }}>
                    <ArrowRightLeft size={12} /> {t('Reassign', 'Chuyển')}
                  </button>
                )}
                {/* Owner manager can withdraw a request they sent, before the
                    target manager accepts or rejects it. */}
                {isManager && u.role === 'staff' && u.manager_id === user?.user_id && u.pending_manager_id && (
                  <button onClick={() => cancelReassign(u.user_id)} title={t('Cancel the pending move', 'Hủy yêu cầu chuyển')} style={{
                    background: 'none', border: '1px solid var(--accent-red)', borderRadius: '6px',
                    padding: '5px 9px', cursor: 'pointer', color: 'var(--accent-red)',
                    fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
                  }}>
                    <X size={12} /> {t('Cancel request', 'Hủy yêu cầu')}
                  </button>
                )}
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
            <Dropdown fullWidth value={form.role} onChange={v => setForm(f => ({ ...f, role: v }))}
              options={[
                { value: 'staff', label: t('Staff', 'Nhân viên'), color: ROLE_COLOR.staff },
                { value: 'manager', label: t('Manager', 'Quản lý'), color: ROLE_COLOR.manager },
                // High-privilege roles can only be created by an admin.
                ...(isAdmin ? [{ value: 'organizer', label: t('Organizer', 'Quản lý sự kiện'), color: ROLE_COLOR.organizer }] : []),
                ...(isAdmin ? [{ value: 'admin', label: t('Admin', 'Quản trị viên'), color: ROLE_COLOR.admin }] : []),
              ]} />
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

      {/* Reassign a staff member to another manager (target must accept). */}
      {reassigning && (
        <Modal
          title={t('Reassign', 'Chuyển') + ' ' + reassigning.name}
          onClose={() => setReassigning(null)}
        >
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
            {t(
              'The chosen manager will receive a request and must accept before the move takes effect.',
              'Quản lý được chọn sẽ nhận một yêu cầu và phải chấp nhận trước khi việc chuyển có hiệu lực.',
            )}
          </p>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {t('New manager', 'Quản lý mới')}
            </label>
            <Dropdown fullWidth value={targetMgr} onChange={setTargetMgr}
              placeholder={t('Select a manager...', 'Chọn quản lý...')}
              options={otherManagers.map(m => ({ value: m.user_id, label: m.name }))} />
          </div>
          {reErr && <p style={{ color: 'var(--accent-red)', fontSize: '13px', marginBottom: '12px' }}>{reErr}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => setReassigning(null)} style={{
              background: 'var(--bg-hover)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: '8px',
              padding: '9px 18px', fontSize: '13px',
            }}>{t('Cancel', 'Hủy')}</button>
            <button onClick={submitReassign} disabled={reSaving} style={{
              background: 'var(--accent-blue)', color: 'white',
              border: 'none', borderRadius: '8px',
              padding: '9px 18px', fontSize: '13px', fontWeight: 600,
              opacity: reSaving ? 0.6 : 1,
            }}>{reSaving ? t('Sending...', 'Đang gửi...') : t('Send request', 'Gửi yêu cầu')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
