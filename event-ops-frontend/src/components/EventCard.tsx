'use client'
import { useRef, useState } from 'react'
import { Calendar, Trash2, ChevronRight, Users, Pencil, AlertTriangle } from 'lucide-react'
import { Event } from '@/lib/types'
import { useLang } from '@/context/LanguageContext'
import StatusBadge from './StatusBadge'
import MilestoneBar from './MilestoneBar'

interface Props {
  event: Event
  onDelete: (id: string) => void
  onClick: (event: Event) => void
  canDelete?: boolean
  onManageMembers?: (event: Event) => void
  onEditDates?: (event: Event) => void
  onEditDetails?: (event: Event) => void
}

// Collapse long descriptions behind a "See more" toggle.
const DESC_LIMIT = 140

// Status accent: pending=yellow, in_progress=blue, completed=green.
const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--accent-amber)',
  in_progress: 'var(--accent-blue)',
  completed: 'var(--accent-green)',
}

export default function EventCard({ event, onDelete, onClick, canDelete = true, onManageMembers, onEditDates, onEditDetails }: Props) {
  const { t, lang } = useLang()
  const [expanded, setExpanded] = useState(false)
  const desc = event.description?.trim()
  const isLong = !!desc && desc.length > DESC_LIMIT

  // Where the pointer went down, so we can tell a real click from the end of a
  // text-selection drag.
  const downPos = useRef<{ x: number; y: number } | null>(null)
  const handleCardClick = (e: React.MouseEvent) => {
    // If the user just selected text, releasing inside the card shouldn't open it.
    if (window.getSelection?.()?.toString()) return
    // Likewise ignore a click that ended a drag (pointer moved more than a few px).
    const d = downPos.current
    if (d && (Math.abs(e.clientX - d.x) > 6 || Math.abs(e.clientY - d.y) > 6)) return
    onClick(event)
  }
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const accent = STATUS_COLOR[event.status] || 'var(--accent-blue)'
  // An event with no members needs a manager — warn whoever can manage members
  // (an event manager) so they don't forget to staff it.
  const needsMembers = event.people_count === 0 && !!onManageMembers
  const borderIdle = needsMembers ? 'var(--accent-amber)' : 'var(--border)'
  return (
    <div
      onMouseDown={e => { downPos.current = { x: e.clientX, y: e.clientY } }}
      onClick={handleCardClick}
      style={{
      background: 'var(--bg-card)',
      border: `1px solid ${borderIdle}`,
      borderLeft: `3px solid ${needsMembers ? 'var(--accent-amber)' : accent}`,
      borderRadius: '12px', padding: '16px 20px',
      display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '12px',
      cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
      boxShadow: needsMembers ? '0 0 14px rgba(245,158,11,0.18)' : undefined,
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLElement).style.borderColor = needsMembers ? 'var(--accent-amber)' : 'var(--border-light)'
      ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLElement).style.borderColor = borderIdle
      ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '10px',
          background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Calendar size={18} color={accent} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            className="selectable"
            onClick={onEditDetails ? (e => { e.stopPropagation(); onEditDetails(event) }) : undefined}
            title={onEditDetails ? t('Edit name & description', 'Sửa tên & mô tả') : undefined}
            style={{
              fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px',
              display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'fit-content', maxWidth: '100%',
              cursor: onEditDetails ? 'pointer' : 'default',
            }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.event_name}</span>
            {onEditDetails && <Pencil size={11} style={{ opacity: 0.7, flexShrink: 0 }} />}
          </p>
          <p
            onClick={onEditDates ? (e => { e.stopPropagation(); onEditDates(event) }) : undefined}
            title={onEditDates ? t('Change dates', 'Đổi thời gian') : undefined}
            style={{
              fontSize: '12px', color: 'var(--text-muted)', width: 'fit-content',
              display: 'flex', alignItems: 'center', gap: '5px',
              cursor: onEditDates ? 'pointer' : 'default',
            }}>
            {fmt(event.start_time)} — {fmt(event.end_time)}
            {onEditDates && <Pencil size={11} style={{ opacity: 0.7 }} />}
          </p>
        </div>
        {event.people_count != null && (
          <span
            onClick={onManageMembers ? (e => { e.stopPropagation(); onManageMembers(event) }) : undefined}
            title={onManageMembers ? t('Manage members', 'Quản lý thành viên') : t('People in this event', 'Số người trong sự kiện')}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600,
              // An empty event (no members) is flagged amber so it's obvious it needs a manager.
              color: event.people_count === 0 ? 'var(--accent-amber)' : 'var(--text-secondary)',
              background: 'var(--bg-hover)',
              padding: '4px 10px', borderRadius: '20px',
              border: `1px solid ${onManageMembers ? 'var(--border-light)' : 'var(--border)'}`,
              cursor: onManageMembers ? 'pointer' : 'default',
            }}>
            <Users size={13} /> {event.people_count === 0 ? t('No members', 'Chưa có thành viên') : event.people_count}
          </span>
        )}
        <StatusBadge status={event.status} />
        {canDelete && (
          <button onClick={e => { e.stopPropagation(); onDelete(event.event_id) }}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '6px', borderRadius: '6px', display: 'flex' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent-red)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
            <Trash2 size={15} />
          </button>
        )}
        <ChevronRight size={15} color="var(--text-muted)" />
      </div>
      {/* Empty-event warning for managers: nudge them to add a member. */}
      {needsMembers && (
        <button
          onClick={e => { e.stopPropagation(); onManageMembers!(event) }}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px', width: '100%', textAlign: 'left',
            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
            borderRadius: '8px', padding: '8px 11px', cursor: 'pointer',
            color: 'var(--accent-amber)', fontSize: '12px', fontWeight: 600,
          }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          {t('No members yet — add a manager to staff this event', 'Chưa có thành viên — thêm quản lý để bố trí nhân sự')}
        </button>
      )}
      {/* Optional description, collapsed behind "See more" when long. */}
      {desc && (
        <p className="selectable" onClick={e => e.stopPropagation()} style={{
          fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0,
        }}>
          {isLong && !expanded ? desc.slice(0, DESC_LIMIT).trimEnd() + '… ' : desc + ' '}
          {isLong && (
            <button
              onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: 'var(--accent-blue)', fontSize: '12px', fontWeight: 600,
              }}>
              {expanded ? t('See less', 'Thu gọn') : t('See more', 'Xem thêm')}
            </button>
          )}
        </p>
      )}
      {/* Milestone tracker: completed / total tasks for this event. */}
      {event.task_count != null && (
        <MilestoneBar completed={event.completed_count ?? 0} total={event.task_count} />
      )}
    </div>
  )
}