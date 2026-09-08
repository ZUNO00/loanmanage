'use client'

import { useEffect, useState } from 'react'
import type { Note } from '@/lib/types'
import { deleteNote, listNotes, upsertNote } from '@/lib/notes'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { NoteForm } from '@/components/NoteForm'

function formatNoteAt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function NoteList() {
  const { session } = useAuth()
  const [notes, setNotes] = useState<Note[]>([])
  const [editing, setEditing] = useState<Note | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const supabase = getSupabaseClient()
  const [now] = useState(() => Date.now())
  const upcomingNotes = notes.filter((n) => new Date(n.note_at).getTime() >= now)

  async function refresh() {
    try {
      setNotes(await listNotes(supabase))
    } catch {
      setError('Không tải được danh sách, thử tải lại trang.')
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount, no data-fetching library in this stack
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(values: Partial<Note>) {
    // No try/catch here: a rejection must propagate to NoteForm's own
    // catch, which is what's actually on screen while editing (this
    // component early-returns to <NoteForm> below).
    await upsertNote(supabase, { ...values, user_id: session!.user.id })
    setEditing(null)
    await refresh()
  }

  async function handleDelete(id: string) {
    try {
      await deleteNote(supabase, id)
      await refresh()
    } catch {
      setError('Không xóa được, thử lại.')
    }
  }

  if (editing) {
    return <NoteForm initial={editing === 'new' ? null : editing} onSubmit={handleSubmit} onCancel={() => setEditing(null)} />
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      {error && <p className="text-sm text-payable">{error}</p>}
      <button onClick={() => setEditing('new')} className="self-start rounded-xl bg-note px-4 py-2 font-semibold text-white">
        + Thêm ghi chú
      </button>
      {upcomingNotes.map((note) => (
        <div key={note.id} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-text">{note.title}</p>
              <p className="text-sm text-text-muted">{formatNoteAt(note.note_at)}</p>
            </div>
            <div className="flex gap-2 text-sm">
              <button onClick={() => setEditing(note)} className="text-text-muted hover:text-text">Sửa</button>
              <button onClick={() => handleDelete(note.id)} className="text-payable">Xóa</button>
            </div>
          </div>
        </div>
      ))}
      {upcomingNotes.length === 0 && <p className="text-text-muted">Chưa có ghi chú sắp tới nào.</p>}
    </div>
  )
}
