const cron = require('node-cron');

const prisma = require('../config/database');
const logger = require('../config/logger');
const groupService = require('../services/group.service');

class GroupPolicyScheduler {
  constructor() {
    this.tasks = new Map();
    this.started = false;
  }

  async start() {
    this.started = true;
    await this.refresh();
    logger.info('Group policy scheduler started');
  }

  stopTask(scheduleId) {
    const task = this.tasks.get(scheduleId);
    if (!task) {
      return;
    }

    try {
      task.stop();
      task.destroy();
    } catch (_error) {
      // Ignore stop errors for stale tasks.
    }
    this.tasks.delete(scheduleId);
  }

  stop() {
    for (const scheduleId of this.tasks.keys()) {
      this.stopTask(scheduleId);
    }
    this.started = false;
    logger.info('Group policy scheduler stopped');
  }

  async refresh() {
    if (!this.started) {
      return;
    }

    for (const scheduleId of this.tasks.keys()) {
      this.stopTask(scheduleId);
    }

    const schedules = await prisma.groupPolicySchedule.findMany({
      where: {
        enabled: true
      },
      select: {
        id: true,
        name: true,
        cronExpression: true,
        timezone: true
      }
    });

    for (const schedule of schedules) {
      if (!cron.validate(schedule.cronExpression)) {
        logger.warn('Invalid cron expression for group policy schedule; skipping registration', {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          cronExpression: schedule.cronExpression
        });
        continue;
      }

      const task = cron.schedule(
        schedule.cronExpression,
        () => {
          void this.execute(schedule.id);
        },
        {
          timezone: schedule.timezone || 'UTC'
        }
      );

      this.tasks.set(schedule.id, task);
      logger.info('Registered group policy schedule task', {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        cronExpression: schedule.cronExpression,
        timezone: schedule.timezone || 'UTC'
      });
    }
  }

  async execute(scheduleId) {
    try {
      const result = await groupService.runPolicySchedule(scheduleId, {
        initiatedBy: 'scheduler',
        source: 'SCHEDULED'
      });
      logger.info('Group policy schedule executed', {
        scheduleId,
        resultSummary: result?.result?.summary || null
      });
      return result;
    } catch (error) {
      logger.error('Group policy schedule failed', {
        scheduleId,
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = new GroupPolicyScheduler();
