const express = require('express');

const { authenticate, authorize } = require('../middleware/auth');
const ApiResponse = require('../utils/response');
const backupManager = require('../backup/manager');

const router = express.Router();

router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));

router.post('/create', async (_req, res, next) => {
  try {
    const archivePath = await backupManager.createBackup();
    return res.json(
      ApiResponse.success({
        message: 'Backup created successfully',
        archivePath
      })
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/list', async (_req, res, next) => {
  try {
    const backups = await backupManager.listBackups();
    return res.json(ApiResponse.success(backups));
  } catch (error) {
    return next(error);
  }
});

router.post('/restore', async (req, res, next) => {
  try {
    const { backupFile } = req.body || {};

    if (!backupFile || typeof backupFile !== 'string') {
      return res.status(400).json(ApiResponse.error('backupFile is required', 'VALIDATION_ERROR'));
    }

    await backupManager.restore(backupFile);
    return res.json(
      ApiResponse.success({
        message: 'Backup restored successfully',
        backupFile
      })
    );
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
