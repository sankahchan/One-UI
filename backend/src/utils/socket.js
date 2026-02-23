let ioInstance = null;

module.exports = {
    init: (server) => {
        const { Server } = require('socket.io');
        ioInstance = new Server(server, {
            cors: {
                origin: '*' // Note: Using the exact same wildcard setup as the primary helmet configuration
            }
        });

        ioInstance.on('connection', (socket) => {
            // Basic initialization console statement - safely ignore if noise is not desired
            // logger.debug(`Client directly connected to socket layer: ${socket.id}`);
        });

        return ioInstance;
    },
    getIo: () => {
        if (!ioInstance) {
            throw new Error('Socket.io layer has not been initialized yet.');
        }
        return ioInstance;
    }
};
