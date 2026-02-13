function userActionsKeyboard(user) {
  const isDisabled = user.status === 'DISABLED';

  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Reset Traffic', callback_data: `user:reset:${user.id}` },
          { text: 'Extend +30d', callback_data: `user:extend:${user.id}:30` }
        ],
        [
          {
            text: isDisabled ? 'Enable User' : 'Disable User',
            callback_data: `user:${isDisabled ? 'enable' : 'disable'}:${user.id}`
          },
          { text: 'Delete User', callback_data: `user:delete:${user.id}` }
        ],
        [{ text: 'Back to Users', callback_data: 'main:users' }]
      ]
    }
  };
}

module.exports = {
  userActionsKeyboard
};
