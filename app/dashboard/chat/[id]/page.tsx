'use client'

import React from 'react'
import ChatWindow from '@/components/ChatWindow'

interface ChatPageProps {
  params: { id: string }
}

export default function ChatPage({ params }: ChatPageProps) {
  return <ChatWindow conversationId={params.id} />
}
