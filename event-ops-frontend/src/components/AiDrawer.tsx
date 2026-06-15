'use client'
import { useState, useRef, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Bot, Send, User, CheckCircle, XCircle, Loader, X, Sparkles, RotateCcw } from 'lucide-react'
import { aiApi, getErrorMessage } from '@/lib/api'
import { useLang } from '@/context/LanguageContext'
import { useAuth } from '@/context/AuthContext'

// A turn in the visible conversation. `role` mirrors the backend's history
// contract ('user' | 'assistant'); `status`/`plan`/`requestId` decorate the
// assistant turn for the various response shapes.
interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'loading' | 'success' | 'rejected' | 'pending' | 'answered'
  // For a pending_confirmation turn: the plan to preview + the request id to
  // confirm/cancel. Cleared once the user acts on it.
  plan?: { kind: string; description: string }[]
  requestId?: string
}

type Mode = 'auto' | 'ask'

// localStorage key PREFIX for the saved conversation. The real key is namespaced
// per user (`ai_chat_history:<userId>`) so different accounts/roles never share a
// transcript — a Manager never sees an Organizer's history. Cleared on logout
// (see AuthContext).
const AI_CHAT_PREFIX = 'ai_chat_history'

// Prepare the transcript for storage: drop in-flight 'loading' turns, and fold an
// awaiting-confirmation plan into plain text — it can't be confirmed after a
// reopen (the server expires the pending plan), so we strip the now-dead
// Confirm/Cancel buttons while keeping the message readable.
function persistableTranscript(turns: Turn[]): Turn[] {
  return turns
    .filter(m => m.status !== 'loading')
    .map(m => {
      if (m.status === 'pending' && m.plan?.length) {
        const list = m.plan.map(p => `• ${p.description}`).join('\n')
        return { ...m, content: `${m.content}\n${list}`, plan: undefined, requestId: undefined }
      }
      return m
    })
}

// ── eventId derivation ──────────────────────────────────────────────────────
// The tasks page stores the "current event" in the URL as `?eventId=` (see
// src/app/tasks/page.tsx — it reads searchParams.get('eventId')). The drawer
// reads that same param so an AI command issued from the tasks view defaults to
// that event; on every other route the param is absent and we send no eventId,
// which the backend treats as a cross-event command. useSearchParams must live
// under a <Suspense> boundary (Next 16) — AiDrawer wraps this hook's consumer
// below so it never forces the whole app shell into client-only rendering.
function useCurrentEventId(): string | undefined {
  const searchParams = useSearchParams()
  return searchParams.get('eventId') || undefined
}

function AiDrawerInner({ onClose }: { onClose: () => void }) {
  const eventId = useCurrentEventId()
  const { t, tError, lang } = useLang()
  const { user } = useAuth()
  // Per-user transcript key, so each account (and therefore each role) keeps its
  // own AI history — a Manager never loads an Organizer's chat.
  const chatKey = `${AI_CHAT_PREFIX}:${user?.user_id ?? 'anon'}`

  const [mode, setMode] = useState<Mode>('auto')
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Grow the textarea to fit its content (wrap onto new lines) up to a cap,
  // then scroll. Called on every change and reset to one row after sending.
  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }

  // Restore the persisted confirm mode on mount (effect, not a lazy initializer,
  // to avoid an SSR/client hydration mismatch — same pattern as LanguageContext).
  useEffect(() => {
    const saved = localStorage.getItem('ai_confirm_mode')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === 'auto' || saved === 'ask') setMode(saved)
  }, [])

  // Persist the conversation so it survives closing/reopening the drawer (and a
  // page reload). The drawer unmounts when closed, so the transcript lives in
  // localStorage, keyed per provider key 'ai_chat_history'. Restored on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(chatKey)
      if (saved) {
        const parsed = JSON.parse(saved) as Turn[]
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(parsed) && parsed.length) setTranscript(parsed)
      }
    } catch { /* ignore corrupt history */ }
  }, [chatKey])

  // Save on every change — but skip the initial mount run so it can't clobber the
  // saved history before the restore effect above has populated it.
  const firstPersist = useRef(true)
  useEffect(() => {
    if (firstPersist.current) { firstPersist.current = false; return }
    try {
      localStorage.setItem(chatKey, JSON.stringify(persistableTranscript(transcript)))
    } catch { /* storage full / unavailable — non-fatal */ }
  }, [transcript, chatKey])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript])

  const setModePersist = (m: Mode) => {
    setMode(m)
    localStorage.setItem('ai_confirm_mode', m)
  }

  // Build a one-line summary from the success/result buckets the backend returns.
  const summarize = (r: Record<string, unknown>): string => {
    const len = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]).length : 0)
    const parts: string[] = []
    const add = (n: number, en: string, vi: string) => { if (n) parts.push(lang === 'en' ? `${en} ${n}` : `${vi} ${n}`) }
    add(len('tasks_created'),    'created',     'tạo')
    add(len('tasks_updated'),    'updated',     'cập nhật')
    add(len('tasks_reassigned'), 'reassigned',  'giao lại')
    add(len('tasks_deleted'),    'deleted',     'xoá')
    add(len('unassigned'),       'unassigned',  'gỡ giao')
    add(len('groups_changed'),   'group changes', 'thay đổi nhóm')
    add(len('events_changed'),   'event changes', 'thay đổi sự kiện')
    add(len('users_changed'),    'account changes', 'thay đổi tài khoản')
    let line = parts.length
      ? (lang === 'en' ? `Done: ${parts.join(', ')}.` : `Hoàn tất: ${parts.join(', ')}.`)
      : (lang === 'en' ? 'No changes were made.' : 'Không có thay đổi nào.')
    const unresolved = len('unresolved')
    if (unresolved) line += lang === 'en'
      ? ` (${unresolved} reference(s) could not be matched)`
      : ` (${unresolved} tham chiếu không khớp)`
    const rejected = len('rejected')
    if (rejected) {
      const reasons = (r.rejected as { reason?: string }[]).map(x => x.reason).filter(Boolean).join('; ')
      line += lang === 'en' ? ` (${rejected} rejected: ${reasons})` : ` (${rejected} bị từ chối: ${reasons})`
    }
    return line
  }

  const appendAssistant = (turn: Omit<Turn, 'id' | 'role'>) =>
    setTranscript(prev => [...prev, { id: Date.now().toString() + 'a' + prev.length, role: 'assistant', ...turn }])

  const handleResult = (res: Record<string, unknown>, loadingId?: string) => {
    const status = res.status as string
    const patch = (turn: Partial<Turn>) => setTranscript(prev =>
      prev.map(m => (m.id === loadingId ? { ...m, ...turn } : m)))

    if (status === 'answered') {
      patch({ status: 'answered', content: String(res.answer ?? '') })
    } else if (status === 'needs_clarification') {
      patch({ status: 'answered', content: String(res.question ?? '') })
      // Keep the input ready for the user's answer.
      inputRef.current?.focus()
    } else if (status === 'pending_confirmation') {
      patch({
        status: 'pending',
        content: lang === 'en' ? 'Review the plan below, then confirm or cancel:' : 'Xem kế hoạch dưới đây rồi xác nhận hoặc huỷ:',
        plan: (res.plan as { kind: string; description: string }[]) ?? [],
        requestId: String(res.request_id ?? ''),
      })
    } else if (status === 'success') {
      patch({ status: 'success', content: summarize(res) })
    } else {
      // Structured rejection / insufficient info.
      patch({
        status: 'rejected',
        content: `${t('Could not process', 'Không thể xử lý')}: ${JSON.stringify(res.reason ?? res)}`,
      })
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return

    const userTurn: Turn = { id: Date.now().toString() + 'u', role: 'user', content: text }
    const loadingTurn: Turn = { id: Date.now().toString() + 'l', role: 'assistant', content: '', status: 'loading' }
    // History the backend expects: the prior turns (excluding this new user turn
    // and any decorative loading turn), mapped to {role, content}.
    const history = transcript
      .filter(m => m.status !== 'loading')
      .map(m => ({ role: m.role, content: m.content }))

    setTranscript(prev => [...prev, userTurn, loadingTurn])
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setBusy(true)
    // No manual refetch is needed here: the open page (tasks/events/etc.)
    // re-fetches itself via its existing useLiveData subscription when the
    // server broadcasts data_changed after the AI mutates anything.
    try {
      const res = await aiApi.command({ eventId, message: text, mode, history })
      handleResult(res as Record<string, unknown>, loadingTurn.id)
    } catch (e) {
      const reason = tError(getErrorMessage(e, 'Could not reach the AI service. Check your DeepSeek API key in .env / Không thể kết nối dịch vụ AI. Kiểm tra khóa API DeepSeek trong .env'))
      setTranscript(prev => prev.map(m => (m.id === loadingTurn.id ? { ...m, status: 'rejected', content: reason } : m)))
    } finally {
      setBusy(false)
    }
  }

  const confirmPlan = async (turnId: string, requestId: string) => {
    if (busy) return
    setBusy(true)
    // Drop the Confirm/Cancel buttons on this turn immediately.
    setTranscript(prev => prev.map(m => (m.id === turnId ? { ...m, plan: undefined, requestId: undefined } : m)))
    try {
      const res = await aiApi.confirm(requestId)
      appendAssistant({ status: 'success', content: summarize(res as Record<string, unknown>) })
    } catch (e) {
      const reason = tError(getErrorMessage(e, 'Could not confirm the plan / Không thể xác nhận kế hoạch'))
      appendAssistant({ status: 'rejected', content: reason })
    } finally {
      setBusy(false)
    }
  }

  const cancelPlan = async (turnId: string, requestId: string) => {
    if (busy) return
    setBusy(true)
    setTranscript(prev => prev.map(m => (m.id === turnId ? { ...m, plan: undefined, requestId: undefined } : m)))
    try {
      await aiApi.cancel(requestId)
      appendAssistant({ status: 'rejected', content: t('Plan cancelled.', 'Đã huỷ kế hoạch.') })
    } catch {
      appendAssistant({ status: 'rejected', content: t('Plan cancelled.', 'Đã huỷ kế hoạch.') })
    } finally {
      setBusy(false)
    }
  }

  // Start a fresh conversation: clear the transcript and the persisted history.
  const resetChat = () => {
    setTranscript([])
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    try { localStorage.removeItem(chatKey) } catch { /* storage unavailable — non-fatal */ }
    inputRef.current?.focus()
  }

  const modeBtn = (m: Mode, label: string) => (
    <button
      onClick={() => setModePersist(m)}
      style={{
        flex: 1, padding: '6px 10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
        border: '1px solid var(--border)', borderRadius: '7px',
        background: mode === m ? 'var(--accent-purple)' : 'transparent',
        color: mode === m ? 'white' : 'var(--text-secondary)',
      }}>
      {label}
    </button>
  )

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 90,
      width: '420px', maxWidth: '100vw',
      background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)',
      boxShadow: '-8px 0 28px rgba(0,0,0,0.35)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 18px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '34px', height: '34px', borderRadius: '9px', background: '#1e1a3a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Bot size={18} color="var(--accent-purple)" />
          </div>
          <div>
            <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
              {t('AI Assistant', 'Trợ lý AI')}
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {eventId
                ? t('Scoped to current event', 'Trong sự kiện hiện tại')
                : t('All events', 'Mọi sự kiện')}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={resetChat}
            disabled={transcript.length === 0 && !input}
            aria-label={t('New chat', 'Trò chuyện mới')}
            title={t('New chat', 'Trò chuyện mới')}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              padding: '4px', borderRadius: '6px', display: 'flex',
              cursor: transcript.length === 0 && !input ? 'default' : 'pointer',
              opacity: transcript.length === 0 && !input ? 0.4 : 1,
            }}>
            <RotateCcw size={17} />
          </button>
          <button onClick={onClose} aria-label={t('Close', 'Đóng')} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            padding: '4px', borderRadius: '6px', display: 'flex', cursor: 'pointer',
          }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
          {t('When the AI is about to make changes', 'Khi AI sắp thực hiện thay đổi')}
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          {modeBtn('auto', t('Auto-accept', 'Tự động'))}
          {modeBtn('ask', t('Ask first', 'Hỏi trước'))}
        </div>
      </div>

      {/* Transcript */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {transcript.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: '24px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '14px', background: '#1e1a3a',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
            }}>
              <Sparkles size={24} color="var(--accent-purple)" />
            </div>
            <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
              {t('How can I help?', 'Tôi có thể giúp gì?')}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {t('Ask a question or give a command in English or Vietnamese — create, reschedule, reassign, plan, or answer.',
                 'Đặt câu hỏi hoặc ra lệnh bằng tiếng Anh hoặc tiếng Việt — tạo, dời hạn, giao lại, lập kế hoạch hoặc trả lời.')}
            </p>
          </div>
        )}

        {transcript.map(msg => (
          <div key={msg.id} style={{
            display: 'flex',
            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            gap: '9px', alignItems: 'flex-start',
          }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
              background: msg.role === 'user' ? '#1e2d4a' : '#1e1a3a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {msg.role === 'user'
                ? <User size={14} color="var(--accent-blue)" />
                : <Bot size={14} color="var(--accent-purple)" />}
            </div>
            <div style={{ maxWidth: '78%' }}>
              <div className="selectable" style={{
                background: msg.role === 'user' ? '#1e2d4a' : 'var(--bg-card)',
                border: `1px solid ${msg.role === 'user' ? 'var(--border-light)' : 'var(--border)'}`,
                borderRadius: '10px', padding: '10px 12px',
              }}>
                {msg.status === 'loading' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                    <Loader size={14} color="var(--accent-purple)" />
                    <span style={{ fontSize: '13px' }}>{t('Thinking...', 'Đang xử lý...')}</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                      {msg.status === 'success'  && <CheckCircle size={14} color="var(--accent-green)" style={{ marginTop: '2px', flexShrink: 0 }} />}
                      {msg.status === 'rejected' && <XCircle     size={14} color="var(--accent-red)"   style={{ marginTop: '2px', flexShrink: 0 }} />}
                      <p style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                    </div>

                    {/* Pending plan preview with Confirm / Cancel */}
                    {msg.plan && msg.requestId && (
                      <div style={{ marginTop: '10px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '10px' }}>
                          {msg.plan.map((step, i) => (
                            <div key={i} style={{
                              background: 'var(--bg-hover)', borderRadius: '6px',
                              padding: '6px 10px', fontSize: '12px', color: 'var(--text-secondary)',
                              borderLeft: '2px solid var(--accent-purple)',
                            }}>
                              {step.description}
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => confirmPlan(msg.id, msg.requestId!)}
                            disabled={busy}
                            style={{
                              flex: 1, background: 'var(--accent-green)', color: 'white', border: 'none',
                              borderRadius: '8px', padding: '8px', fontSize: '12px', fontWeight: 600,
                              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
                            }}>
                            {t('Confirm', 'Xác nhận')}
                          </button>
                          <button
                            onClick={() => cancelPlan(msg.id, msg.requestId!)}
                            disabled={busy}
                            style={{
                              flex: 1, background: 'transparent', color: 'var(--text-secondary)',
                              border: '1px solid var(--border)', borderRadius: '8px', padding: '8px',
                              fontSize: '12px', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
                            }}>
                            {t('Cancel', 'Huỷ')}
                          </button>
                        </div>
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

      {/* Input */}
      <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={e => { setInput(e.target.value); autoGrow(e.target) }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={t('Ask or command... (Shift+Enter for new line)', 'Hỏi hoặc ra lệnh... (Shift+Enter để xuống dòng)')}
            disabled={busy}
            style={{ flex: 1, resize: 'none', overflowY: 'auto', maxHeight: '140px', lineHeight: 1.45, fontFamily: 'inherit' }}
          />
          <button onClick={send} disabled={!input.trim() || busy}
            style={{
              background: 'var(--accent-purple)', color: 'white', border: 'none', borderRadius: '9px',
              padding: '10px 16px', fontSize: '13px', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '6px',
              opacity: (!input.trim() || busy) ? 0.5 : 1, flexShrink: 0,
              cursor: (!input.trim() || busy) ? 'default' : 'pointer',
            }}>
            <Send size={14} /> {t('Send', 'Gửi')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Global, context-aware AI surface. A non-modal slide-over panel (the page
 * behind it stays visible and interactive) toggled by a floating launcher.
 * Gating to allowed roles is done by the caller (AppShell).
 */
export default function AiDrawer() {
  const [open, setOpen] = useState(false)
  const { t } = useLang()

  return (
    <>
      {/* Floating launcher (bottom-right). Hidden while the drawer is open. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={t('Open AI Assistant', 'Mở Trợ lý AI')}
          title={t('AI Assistant', 'Trợ lý AI')}
          style={{
            position: 'fixed', bottom: '24px', right: '24px', zIndex: 80,
            width: '52px', height: '52px', borderRadius: '50%',
            background: 'var(--accent-purple)', color: 'white', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)', cursor: 'pointer',
          }}>
          <Bot size={24} />
        </button>
      )}

      {/* useSearchParams (inside AiDrawerInner) must sit under a Suspense
          boundary in Next 16; rendering only when open also avoids the WS/API
          work until the user actually opens the drawer. */}
      {open && (
        <Suspense fallback={null}>
          <AiDrawerInner onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
