'use client'
import { useState, useRef, useEffect } from 'react'
import { Bot, Send, User, CheckCircle, XCircle, Loader } from 'lucide-react'
import { aiApi, eventsApi } from '@/lib/api'
import { Event, Task } from '@/lib/types'
import TopBar from '@/components/TopBar'
import { useAuth } from '@/context/AuthContext'

interface Message {
  id: string
  role: 'user' | 'ai'
  text: string
  tasks?: Task[]
  status?: 'success' | 'rejected' | 'loading'
}

const examples = [
  'Create 3 tasks for venue setup by next Friday, assign to the team, high priority',
  'Add a task to check audio equipment with medium priority, deadline this Sunday',
  'Create catering coordination task with high priority, deadline 2025-09-01',
]

export default function AiPage() {
  const [events, setEvents]     = useState<Event[]>([])
  const [eventId, setEventId]   = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const bottomRef               = useRef<HTMLDivElement>(null)
  const { user }                = useAuth()

  useEffect(() => { eventsApi.getAll().then(setEvents) }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || !eventId || loading) return

    const userMsg: Message = { id: Date.now().toString(),        role: 'user', text }
    const aiMsg:   Message = { id: Date.now().toString() + 'ai', role: 'ai',  text: '', status: 'loading' }

    setMessages(prev => [...prev, userMsg, aiMsg])
    setInput('')
    setLoading(true)

    try {
      const result = await aiApi.command(user?.user_id || '', eventId, text)
      setMessages(prev => prev.map(m =>
        m.id === aiMsg.id ? {
          ...m,
          status: result.status,
          text: result.status === 'success'
            ? `Successfully created ${result.tasks_created?.length ?? 0} task(s).`
            : `Could not process: ${JSON.stringify(result.reason)}`,
          tasks: result.tasks_created,
        } : m
      ))
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === aiMsg.id
          ? { ...m, status: 'rejected', text: 'Error connecting to AI. Check your DeepSeek API key in .env' }
          : m
      ))
    } finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar title="AI Assistant" titleVi="Trợ lý AI" />

      <div style={{ padding: '16px 28px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <div style={{ maxWidth: '500px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Select Event / Chọn sự kiện
          </label>
          <select value={eventId} onChange={e => setEventId(e.target.value)}>
            <option value="">— Select an event first —</option>
            {events.map(e => <option key={e.event_id} value={e.event_id}>{e.event_name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: '40px' }}>
            <div style={{
              width: '56px', height: '56px', borderRadius: '16px', background: '#1e1a3a',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
            }}>
              <Bot size={28} color="var(--accent-purple)" />
            </div>
            <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
              AI Task Assistant
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>
              Type a command in English or Vietnamese to create tasks automatically.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '500px', margin: '0 auto' }}>
              {examples.map((ex, i) => (
                <button key={i} onClick={() => setInput(ex)} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: '8px', padding: '10px 14px',
                  fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'left', cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-purple)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'}>
                  &ldquo;{ex}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={{
            display: 'flex',
            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            gap: '10px', alignItems: 'flex-start',
          }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
              background: msg.role === 'user' ? '#1e2d4a' : '#1e1a3a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {msg.role === 'user' ? <User size={15} color="var(--accent-blue)" /> : <Bot size={15} color="var(--accent-purple)" />}
            </div>
            <div style={{ maxWidth: '70%' }}>
              <div style={{
                background: msg.role === 'user' ? '#1e2d4a' : 'var(--bg-card)',
                border: `1px solid ${msg.role === 'user' ? 'var(--border-light)' : 'var(--border)'}`,
                borderRadius: '10px', padding: '12px 14px',
              }}>
                {msg.status === 'loading' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                    <Loader size={14} color="var(--accent-purple)" />
                    <span style={{ fontSize: '13px' }}>Processing your command...</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      {msg.status === 'success'  && <CheckCircle size={14} color="var(--accent-green)" />}
                      {msg.status === 'rejected' && <XCircle     size={14} color="var(--accent-red)"   />}
                      <p style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.5 }}>{msg.text}</p>
                    </div>
                    {msg.tasks && msg.tasks.length > 0 && (
                      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {msg.tasks.map(t => (
                          <div key={t.task_id} style={{
                            background: 'var(--bg-hover)', borderRadius: '6px',
                            padding: '6px 10px', fontSize: '12px', color: 'var(--text-secondary)',
                            borderLeft: '2px solid var(--accent-purple)',
                          }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.task_name}</span>
                            {' · '}{t.priority_label} priority
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        {!eventId && (
          <p style={{ fontSize: '12px', color: 'var(--accent-amber)', marginBottom: '8px' }}>
            ⚠ Please select an event above before sending a command.
          </p>
        )}
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Type a command... / Nhập lệnh..."
            disabled={!eventId || loading}
            style={{ flex: 1 }}
          />
          <button onClick={send} disabled={!eventId || !input.trim() || loading}
            style={{
              background: 'var(--accent-purple)', color: 'white',
              border: 'none', borderRadius: '9px',
              padding: '10px 18px', fontSize: '13px', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '6px',
              opacity: (!eventId || !input.trim() || loading) ? 0.5 : 1, flexShrink: 0,
            }}>
            <Send size={14} /> Send
          </button>
        </div>
      </div>
    </div>
  )
}