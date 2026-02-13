const QRCode = require('qrcode');

async function generateQRCodeDataURL(content) {
  return QRCode.toDataURL(content, {
    type: 'image/png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280
  });
}

module.exports = {
  generateQRCodeDataURL
};
