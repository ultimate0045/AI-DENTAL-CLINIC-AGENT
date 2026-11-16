'use client'

import { useEffect, useState, useCallback } from 'react'
import { Socket } from 'socket.io-client'
import { getSocket } from '@/lib/socket'
import { ChatMessage } from '@/types/index'

export interface UseSocketReturn {
  socket: Socket | null
  isConnected: boolean
  sendMessage: (content: string, phone: string) => Promise<boolean>
  toggleAIMode: (aiMode: boolean) => void
}

export function useSocket(
  conversationId?: string,
  onNewMessage?: (msg: ChatMessage) => void,
  onAIModeChange?: (aiMode: boolean) => void
): UseSocketReturn {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(false)

  useEffect(() => {
    const s = getSocket()
    setSocket(s)

    function handleConnect() {
      setIsConnected(true)
      if (conversationId) {
        s.emit('join_conversation', conversationId)
      }
    }

    function handleDisconnect() {
      setIsConnected(false)
    }

    if (s.connected) {
      setIsConnected(true)
      if (conversationId) {
        s.emit('join_conversation', conversationId)
      }
    }

    s.on('connect', handleConnect)
    s.on('disconnect', handleDisconnect)

    return () => {
      s.off('connect', handleConnect)
      s.off('disconnect', handleDisconnect)
    }
  }, [conversationId])

  useEffect(() => {
    if (!socket || !conversationId) return

    socket.emit('join_conversation', conversationId)

    const handleMessage = (data: any) => {
      if (data?.conversationId === conversationId || data?.conversation_id === conversationId) {
        if (onNewMessage) {
          const formattedMsg: ChatMessage = {
            id: data.id || `msg-${Date.now()}`,
            conversationId: data.conversationId || data.conversation_id,
            role: data.role || 'user',
            content: data.content || '',
            timestamp: data.timestamp || data.created_at || new Date().toISOString(),
            status: data.status || 'delivered',
            mediaUrl: data.mediaUrl || data.media_url,
            mediaType: data.mediaType || data.message_type,
          }
          onNewMessage(formattedMsg)
        }
      }
    }

    const handleAiMode = (data: any) => {
      if (data?.conversationId === conversationId && typeof data?.aiMode === 'boolean') {
        if (onAIModeChange) onAIModeChange(data.aiMode)
      }
    }

    socket.on('new_message', handleMessage)
    socket.on('ai_mode_updated', handleAiMode)

    return () => {
      socket.off('new_message', handleMessage)
      socket.off('ai_mode_updated', handleAiMode)
    }
  }, [socket, conversationId, onNewMessage, onAIModeChange])

  const sendMessage = useCallback(
    async (content: string, phone: string): Promise<boolean> => {
      if (!content.trim() || !conversationId) return false

      try {
        const serverUrl = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001'
        const res = await fetch(`${serverUrl}/api/send-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            phone,
            message: content,
          }),
        })

        if (!res.ok) {
          throw new Error('Failed to send message via server')
        }

        // Also emit via socket for immediate local/room delivery
        if (socket && isConnected) {
          socket.emit('send_message', {
            conversationId,
            phone,
            content,
            role: 'assistant',
          })
        }

        return true
      } catch (err) {
        console.error('Failed to send message:', err)
        return false
      }
    },
    [conversationId, socket, isConnected]
  )

  const toggleAIMode = useCallback(
    (aiMode: boolean) => {
      if (!conversationId) return

      // Emit over socket
      if (socket) {
        socket.emit('toggle_ai_mode', {
          conversationId,
          aiMode,
        })
      }

      // Also call server API
      const serverUrl = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001'
      fetch(`${serverUrl}/api/conversations/${conversationId}/toggle-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiMode }),
      }).catch((e) => console.warn('toggle-ai error:', e))
    },
    [conversationId, socket]
  )

  return {
    socket,
    isConnected,
    sendMessage,
    toggleAIMode,
  }
}
