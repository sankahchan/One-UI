import { QRCodeSVG, type QRCodeSVGProps } from 'qrcode.react';

import oneUiLogo from '../../assets/one-ui-logo.svg';

type BrandedQRCodeProps = Omit<QRCodeSVGProps, 'imageSettings'> & {
  logoUrl?: string | null;
  logoSizePercent?: number;
  imageSettings?: QRCodeSVGProps['imageSettings'];
};

export const BrandedQRCode = ({
  logoUrl,
  logoSizePercent = 22,
  size = 200,
  level = 'H',
  includeMargin = false,
  imageSettings,
  ...rest
}: BrandedQRCodeProps) => {
  const numericSize = Number.isFinite(size) ? Number(size) : 200;
  const percent = Math.min(Math.max(Number(logoSizePercent || 22), 10), 40);
  const logoSize = Math.max(14, Math.round((numericSize * percent) / 100));
  const src = logoUrl || oneUiLogo;

  const mergedImageSettings = {
    src,
    width: logoSize,
    height: logoSize,
    excavate: true
  };
  if (imageSettings) {
    Object.assign(mergedImageSettings, imageSettings);
    mergedImageSettings.src = imageSettings.src ?? src;
    mergedImageSettings.width = imageSettings.width ?? logoSize;
    mergedImageSettings.height = imageSettings.height ?? logoSize;
    mergedImageSettings.excavate = imageSettings.excavate ?? true;
  }

  return (
    <QRCodeSVG
      {...rest}
      size={numericSize}
      level={level}
      includeMargin={includeMargin}
      imageSettings={mergedImageSettings}
    />
  );
};
