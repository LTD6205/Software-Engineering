'use client'
import { useEffect, useState } from 'react'
import { Plus, Users, UserCheck, UserX } from 'lucide-react'
import TopBar from '@/components/TopBar'
import Modal from '@/components/Modal'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api'

interface TeamUser {
  user_id: string
  name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
}

const empty = { name: '', email: '', password: '', role: 'staff' }

export default function UsersPage() {
  const { isManager } = useAuth()
  const router = useRouter()
  const [users, setUsers]         = useState<TeamUser[]>([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]           = useState({ ...empty })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    if (!isManager) { router.push('/'); return }
    axios.get(`${API}/users`).then(r => setUsers(r.data)).finally(() => setLoading(false))
  }, [isManager])

  const handleCreate = async () => {
    if (!form.name || !form.email || !form.password) {
      setError('Name, email and password are required.'); return
    }
    setSaving(true); setError('')
    try {
      const res = await axios.post(`${API}/users`, form)
      setUsers(prev => [...prev, res.data])
      setShowModal(false); setForm({ ...empty })
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to create user.')
    } finally { setSaving(false) }
  }

  const toggleActive = async (u: TeamUser) => {
    if (!confirm(`${u.is_active ? 'Deactivate' : 'Reactivate'} ${u.name}?`)) return
    await axios.put(`${API}/users/${u.user_id}`, { is_active: !u.is_active })
    setUsers(prev => prev.map(x => x.user_id === u.user_id ? { ...x, is_active: !u.is_active } : x))
  }

  const roleColor: Record<string, string> = {
    manager: 'var(--accent-blue)',
    admin:   'var(--accent-purple)',
    staff:   'var(--accent-teal)',
  }

  return (
    <div>
      <TopBar title="Team" titleVi="Nhân viên" />
      <div style={{ padding: '28px', maxWidth: '800px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{users.length} members</p>
          <button onClick={() => setShowModal(true)} style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            background: 'var(--accent-blue)', color: 'white',
            border: 'none', borderRadius: '9px', padding: '9px 18px', fontSize: '13px', fontWeight: 600,
          }}>
            <Plus size={15} /> Add Member / Thêm nhân viên
          </button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {users.map(u => (
              <div key={u.user_id} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: '10px', padding: '14px 18px',
                display: 'flex', alignItems: 'center', gap: '14px',
                opacity: u.is_active ? 1 : 0.5,
              }}>
                <div style={{
                  width: '38px', height: '38px', borderRadius: '10px',
                  background: (roleColor[u.role] || 'var(--accent-teal)') + '22',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Users size={17} color={roleColor[u.role] || 'var(--accent-teal)'} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{u.name}</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{u.email}</p>
                </div>
                <span style={{
                  fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '12px',
                  background: (roleColor[u.role] || 'var(--accent-teal)') + '22',
                  color: roleColor[u.role] || 'var(--accent-teal)',
                }}>{u.role}</span>
                <span style={{
                  fontSize: '11px', padding: '3px 8px', borderRadius: '12px',
                  background: u.is_active ? '#1a3320' : '#2a2a2a',
                  color: u.is_active ? 'var(--accent-green)' : 'var(--text-muted)',
                }}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => toggleActive(u)} style={{
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: '6px', padding: '5px 8px', cursor: 'pointer',
                  color: u.is_active ? 'var(--accent-red)' : 'var(--accent-green)',
                  fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  {u.is_active
                    ? <><UserX size={12} /> Deactivate</>
                    : <><UserCheck size={12} /> Activate</>}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <Modal title="Add Team Member / Thêm nhân viên" onClose={() => { setShowModal(false); setError('') }}>
          {[
            { label: 'Full Name', vi: 'Họ và tên', key: 'name', type: 'text' },
            { label: 'Email',     vi: 'Email',     key: 'email', type: 'email' },
            { label: 'Password',  vi: 'Mật khẩu', key: 'password', type: 'password' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {f.label} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/ {f.vi}</span>
              </label>
              <input type={f.type} value={(form as any)[f.key]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} />
            </div>
          ))}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Role / Vai trò
            </label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="staff">Staff / Nhân viên</option>
              <option value="manager">Manager / Quản lý</option>
            </select>
          </div>
          {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowModal(false); setError('') }} style={{
              background: 'var(--bg-hover)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: '8px',
              padding: '9px 18px', fontSize: '13px',
            }}>Cancel</button>
            <button onClick={handleCreate} disabled={saving} style={{
              background: 'var(--accent-blue)', color: 'white',
              border: 'none', borderRadius: '8px',
              padding: '9px 18px', fontSize: '13px', fontWeight: 600,
              opacity: saving ? 0.6 : 1,
            }}>{saving ? 'Adding...' : 'Add Member'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}