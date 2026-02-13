function mainMenuReplyKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📊 Status' }, { text: '👥 Users' }],
        [{ text: '🖥 System' }, { text: '📄 Report' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

function mainMenuInlineKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Status', callback_data: 'main:status' },
          { text: 'Users', callback_data: 'main:users' }
        ],
        [
          { text: 'System', callback_data: 'main:system' },
          { text: 'Report', callback_data: 'main:report' }
        ]
      ]
    }
  };
}

module.exports = {
  mainMenuReplyKeyboard,
  mainMenuInlineKeyboard
};
