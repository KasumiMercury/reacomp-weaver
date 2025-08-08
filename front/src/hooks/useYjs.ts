'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'

export function useYjs(roomName: string) {
  const [text, setText] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [connectedUsers, setConnectedUsers] = useState(0)
  const [userList, setUserList] = useState<Array<{id: number, name: string, color: string}>>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  
  const ydocRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<WebrtcProvider | null>(null)
  const ytextRef = useRef<Y.Text | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  
  const cleanup = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
  }, [])
  
  useEffect(() => {
    cleanup()
    
    const ydoc = new Y.Doc()
    
    const provider = new WebrtcProvider(roomName, ydoc, {
      signaling: [
          process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'ws://localhost:8787/ws'
      ],
      maxConns: 20,
      filterBcConns: true,
      peerOpts: {}
    })
    
    const ytext = ydoc.getText('shared-text')
    
    ydocRef.current = ydoc
    providerRef.current = provider
    ytextRef.current = ytext
    
    setText(ytext.toString())
    
    const updateText = () => {
      setText(ytext.toString())
    }
    
    const updateConnectionStatus = () => {
      const connected = provider.connected
      const awarenessStates = provider.awareness.getStates()
      const userCount = awarenessStates.size
      
      const users = Array.from(awarenessStates.entries()).map(([clientId, state]) => ({
        id: clientId,
        name: state.user?.name || `User-${clientId}`,
        color: state.user?.color || '#666666'
      }))
      
      setIsConnected(connected)
      setConnectedUsers(userCount)
      setUserList(users)
    }
    
    ytext.observe(updateText)
    provider.on('status', updateConnectionStatus)
    provider.awareness.on('change', updateConnectionStatus)
    provider.on('peers', updateConnectionStatus)
    
    const userId = ydoc.clientID
    setCurrentUserId(userId)
    
    provider.awareness.setLocalStateField('user', {
      name: `User-${Math.random().toString(36).substring(2, 9)}`,
      color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
      timestamp: Date.now()
    })
    
    setTimeout(updateConnectionStatus, 100)
    
    cleanupRef.current = () => {
      ytext.unobserve(updateText)
      provider.off('status', updateConnectionStatus)
      provider.awareness.off('change', updateConnectionStatus)
      provider.off('peers', updateConnectionStatus)
      provider.destroy()
      ydoc.destroy()
    }
    
    return cleanup
  }, [roomName, cleanup])
  
  const updateText = useCallback((newText: string) => {
    if (ytextRef.current) {
      const ytext = ytextRef.current
      const currentText = ytext.toString()
      
      if (currentText !== newText) {
        ytext.delete(0, currentText.length)
        ytext.insert(0, newText)
      }
    }
  }, [])
  
  return {
    text,
    updateText,
    isConnected,
    connectedUsers,
    userList,
    currentUserId
  }
}