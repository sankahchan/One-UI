import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
    text: string;
    size?: number;
    logoUrl?: string | null;
    logoSizePercent?: number;
    className?: string;
}

export const QRCodeDisplay = ({
  text,
  size = 200,
  logoUrl = null,
  logoSizePercent = 22,
  className = ''
}: QRCodeDisplayProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const drawLogo = async () => {
        if (!logoUrl) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        await new Promise<void>((resolve) => {
          const logo = new Image();
          logo.crossOrigin = 'anonymous';
          logo.onload = () => {
            const percent = Math.min(Math.max(logoSizePercent, 10), 40);
            const logoSize = (size * percent) / 100;
            const logoX = (size - logoSize) / 2;
            const logoY = (size - logoSize) / 2;

            // White round background to keep QR readable.
            ctx.save();
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, logoSize / 2 + 6, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();

            ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
            resolve();
          };
          logo.onerror = () => resolve();
          logo.src = logoUrl;
        });
      };

      QRCode.toCanvas(
        canvas,
        text,
        {
          width: size,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff'
          },
          errorCorrectionLevel: 'H'
        },
        (error) => {
          if (error) {
            console.error('Error generating QR code:', error);
            return;
          }

          void drawLogo();
        }
      );
    }, [text, size, logoUrl, logoSizePercent]);

    return <canvas ref={canvasRef} className={className} />;
};
