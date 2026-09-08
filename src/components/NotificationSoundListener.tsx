'use client'

import { useEffect } from 'react'

function playBell() {
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return
  const ctx = new AudioContextCtor()
  const startTime = ctx.currentTime
  ;[880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    osc.connect(gain)
    gain.connect(ctx.destination)
    const start = startTime + i * 0.18
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
    osc.start(start)
    osc.stop(start + 0.18)
  })
}

export function NotificationSoundListener() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'PLAY_REMINDER_SOUND') playBell()
    }
    navigator.serviceWorker.addEventListener('message', handleMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage)
  }, [])

  return null
}
