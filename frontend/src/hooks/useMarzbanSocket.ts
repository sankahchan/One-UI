import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../api/client'; // Base URL is typically /api -> Socket needs just domain

let socket: Socket | null = null;

export const useMarzbanSocket = () => {
    const queryClient = useQueryClient();

    useEffect(() => {
        // Determine the base origin for Socket.io. API_URL might be http://.../api
        const origin = API_URL.replace(/\/api\/?$/, '') || window.location.origin;

        if (!socket) {
            socket = io(origin, {
                reconnectionAttempts: 5,
                reconnectionDelay: 2000
            });
        }

        const handleMarzbanEvent = (payload: { username: string; action: string; timestamp: number }) => {
            console.log('Real-time Marzban Event:', payload);
            // Depending on the event, we aggressively invalidate the users query so React Query refetches
            queryClient.invalidateQueries({ queryKey: ['marzban-users'] });

            // We can also invalidate system stats on user operations!
            queryClient.invalidateQueries({ queryKey: ['marzban-system-stats'] });
        };

        socket.on('marzban_event', handleMarzbanEvent);

        return () => {
            socket?.off('marzban_event', handleMarzbanEvent);
        };
    }, [queryClient]);
};
