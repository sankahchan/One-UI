import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
    text: string;
    size?: number;
    className?: string;
}

export const QRCodeDisplay = ({ text, size = 200, className = '' }: QRCodeDisplayProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (canvasRef.current) {
            QRCode.toCanvas(canvasRef.current, text, {
                width: size,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff',
                },
            }, (error) => {
                if (error) console.error('Error generating QR code:', error);
            });
        }
    }, [text, size]);

    return <canvas ref={canvasRef} className={className} />;
};
