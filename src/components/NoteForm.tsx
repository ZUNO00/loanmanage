'use client'

import { useState } from 'react'
import type { Note } from '@/lib/types'
import { parseDictation } from '@/lib/dictation'

interface Props {
  initial: Partial<Note> | null
  onSubmit: (values: Partial<Note>) => Promise<void>
  onCancel: () => void
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function NoteForm({ initial, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [noteAtLocal, setNoteAtLocal] = useState(toDatetimeLocal(initial?.note_at))
  const [transcript, setTranscript] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function applyDictation(text: string) {
    setTranscript(text)
    const parsed = parseDictation(text)
    if (parsed.date || parsed.time) {
      const [datePart, timePart] = noteAtLocal.split('T')
      const newDate = parsed.date ?? datePart ?? ''
      const newTime = parsed.time ?? timePart ?? '00:00'
      if (newDate) setNoteAtLocal(`${newDate}T${newTime}`)
    }
    if (!title && text.trim()) setTitle(text.trim())
  }

  function startDictation() {
    // Web Speech API types aren't in TS's lib.dom.d.ts — declare the minimal
    // shape we use instead of relying on an ambient global that isn't there.
    type MinimalRecognition = {
      lang: string
      start: () => void
      onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null
    }
    const Ctor = (window as unknown as { webkitSpeechRecognition?: new () => MinimalRecognition }).webkitSpeechRecognition
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.lang = 'vi-VN'
    recognition.onresult = (event) => applyDictation(event.results[0][0].transcript)
    recognition.start()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        id: initial?.id,
        title,
        note_at: noteAtLocal ? new Date(noteAtLocal).toISOString() : undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra, thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  const showMic = typeof window !== 'undefined' && 'webkitSpeechRecognition' in window

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      {showMic && (
        <button type="button" onClick={startDictation} className="self-start rounded-full bg-bg px-3 py-1.5 text-sm text-text">
          🎤 Đọc điền nhanh
        </button>
      )}
      {transcript && <p className="text-xs text-text-muted">Đã nghe: &quot;{transcript}&quot;</p>}

      <input className="rounded-lg bg-bg px-3 py-2 text-text" placeholder="Tiêu đề" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <input className="rounded-lg bg-bg px-3 py-2 text-text" type="datetime-local" value={noteAtLocal} onChange={(e) => setNoteAtLocal(e.target.value)} required />

      {error && <p className="text-sm text-payable">{error}</p>}
      <div className="flex gap-2">
        <button disabled={submitting} className="flex-1 rounded-xl bg-note py-2 font-semibold text-white disabled:opacity-50" type="submit">
          Lưu
        </button>
        <button type="button" onClick={onCancel} className="flex-1 rounded-xl bg-bg py-2 text-text-muted">
          Hủy
        </button>
      </div>
    </form>
  )
}
