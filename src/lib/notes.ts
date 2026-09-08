import type { SupabaseClient } from '@supabase/supabase-js'
import type { Note } from './types'

export async function listNotes(supabase: SupabaseClient): Promise<Note[]> {
  const { data, error } = await supabase.from('notes').select('*').order('note_at', { ascending: true })
  if (error) throw error
  return data as Note[]
}

export async function upsertNote(supabase: SupabaseClient, note: Partial<Note> & { user_id: string }): Promise<Note> {
  const { data, error } = await supabase.from('notes').upsert(note).select().single()
  if (error) throw error
  return data as Note
}

export async function deleteNote(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', id)
  if (error) throw error
}
