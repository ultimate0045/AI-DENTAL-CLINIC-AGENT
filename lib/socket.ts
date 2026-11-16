import { io, Socket } from 'socket.io-client'

let socketInstance: Socket | null = null

export function getSocket(): Socket {
  if (typeof window === 'undefined') {
    // Return dummy on server side
    return {} as Socket
  }

  if (!socketInstance) {
    const serverUrl = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001'
    socketInstance = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
    })

    socketInstance.on('connect', () => {
      console.log('⚡ Socket connected to server:', socketInstance?.id)
    })

    socketInstance.on('disconnect', (reason) => {
      console.log('⚡ Socket disconnected:', reason)
    })

    socketInstance.on('connect_error', (err) => {
      console.warn('⚡ Socket connection error:', err.message)
    })
  }

  return socketInstance
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect()
    socketInstance = null
  }
}
