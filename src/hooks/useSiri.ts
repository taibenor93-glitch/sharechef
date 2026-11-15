import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { siriInbox, startSiriRouting } from '../lib/siri'
import type { SiriSource } from '../lib/siri'

// Native side: ios/App/App/MicheliSiriPlugin.swift
const MicheliSiriNative = registerPlugin<SiriSource>('MicheliSiri')

/**
 * Collects "Hey Siri" requests from the iPhone and brings the user to the home
 * screen, where the request is carried out (see the Siri block in Home.tsx).
 *
 * All the behaviour lives in src/lib/siri.ts, covered by tests/siri.test.mjs.
 * This is only the lifecycle glue. Outside the iPhone app it does nothing.
 *
 * Auth is deliberately untouched: a signed-out user lands on the sign-in page
 * the same way they would by opening the app, and the request quietly expires.
 */
export function useSiri(): void {
  const navigate = useNavigate()

  // In a ref so the subscription is created exactly once (see useDeepLinks).
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return
    return startSiriRouting(MicheliSiriNative, (action) => {
      siriInbox.put(action)
      navigateRef.current('/')
    })
  }, [])
}
