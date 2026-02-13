const groupService = require('../services/group.service');
const groupPolicyScheduler = require('../jobs/group-policy-scheduler');
const { sendSuccess } = require('../utils/response');

async function listGroups(req, res, next) {
  try {
    const result = await groupService.listGroups({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      includeDisabled: req.query.includeDisabled
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Groups retrieved successfully',
      data: result.groups,
      meta: result.pagination
    });
  } catch (error) {
    return next(error);
  }
}

async function getGroup(req, res, next) {
  try {
    const group = await groupService.getGroupById(req.params.id);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group retrieved successfully',
      data: group
    });
  } catch (error) {
    return next(error);
  }
}

async function createGroup(req, res, next) {
  try {
    const group = await groupService.createGroup(req.body || {});

    return sendSuccess(res, {
      statusCode: 201,
      message: 'Group created successfully',
      data: group
    });
  } catch (error) {
    return next(error);
  }
}

async function updateGroup(req, res, next) {
  try {
    const group = await groupService.updateGroup(req.params.id, req.body || {});

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group updated successfully',
      data: group
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteGroup(req, res, next) {
  try {
    const result = await groupService.deleteGroup(req.params.id);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group deleted successfully',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function addUsers(req, res, next) {
  try {
    const group = await groupService.addUsers(req.params.id, req.body.userIds || []);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Users added to group successfully',
      data: group
    });
  } catch (error) {
    return next(error);
  }
}

async function removeUsers(req, res, next) {
  try {
    const group = await groupService.removeUsers(req.params.id, req.body.userIds || []);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Users removed from group successfully',
      data: group
    });
  } catch (error) {
    return next(error);
  }
}

async function moveUsers(req, res, next) {
  try {
    const group = await groupService.moveUsers(req.params.id, req.body.userIds || []);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Users moved to group successfully',
      data: group
    });
  } catch (error) {
    return next(error);
  }
}

async function setInbounds(req, res, next) {
  try {
    const group = await groupService.setInbounds(req.params.id, req.body.inboundIds || []);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group inbounds updated successfully',
      data: group
    });
  } catch (error) {
    return next(error);
  }
}

async function applyPolicy(req, res, next) {
  try {
    const result = await groupService.applyGroupPolicy(req.params.id, {
      userIds: req.body.userIds || [],
      dryRun: req.body.dryRun,
      initiatedBy: req.admin?.username || null,
      source: 'MANUAL'
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: result.dryRun ? 'Group policy dry-run completed' : 'Group policy applied successfully',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function listPolicyTemplates(req, res, next) {
  try {
    const result = await groupService.listPolicyTemplates({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group policy templates retrieved successfully',
      data: result.templates,
      meta: result.pagination
    });
  } catch (error) {
    return next(error);
  }
}

async function getPolicyTemplate(req, res, next) {
  try {
    const template = await groupService.getPolicyTemplateById(req.params.templateId);
    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group policy template retrieved successfully',
      data: template
    });
  } catch (error) {
    return next(error);
  }
}

async function createPolicyTemplate(req, res, next) {
  try {
    const template = await groupService.createPolicyTemplate(req.body || {});
    return sendSuccess(res, {
      statusCode: 201,
      message: 'Group policy template created successfully',
      data: template
    });
  } catch (error) {
    return next(error);
  }
}

async function updatePolicyTemplate(req, res, next) {
  try {
    const template = await groupService.updatePolicyTemplate(req.params.templateId, req.body || {});
    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group policy template updated successfully',
      data: template
    });
  } catch (error) {
    return next(error);
  }
}

async function deletePolicyTemplate(req, res, next) {
  try {
    const result = await groupService.deletePolicyTemplate(req.params.templateId);
    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group policy template deleted successfully',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function applyPolicyTemplate(req, res, next) {
  try {
    const group = await groupService.applyPolicyTemplateToGroup(req.params.id, req.body.templateId);
    const shouldApplyNow = req.body.applyNow === true;
    const dryRun = req.body.dryRun === true;
    let applyResult = null;

    if (shouldApplyNow) {
      applyResult = await groupService.applyGroupPolicy(req.params.id, {
        userIds: req.body.userIds || [],
        dryRun,
        initiatedBy: req.admin?.username || null,
        source: 'MANUAL',
        templateId: req.body.templateId
      });
    }

    return sendSuccess(res, {
      statusCode: 200,
      message: shouldApplyNow
        ? (dryRun ? 'Template applied and policy dry-run completed' : 'Template applied and policy rollout executed')
        : 'Template applied to group policy successfully',
      data: {
        group,
        applyResult
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function listPolicySchedules(req, res, next) {
  try {
    const result = await groupService.listPolicySchedules({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      groupId: req.query.groupId,
      enabled: req.query.enabled
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group policy schedules retrieved successfully',
      data: result.schedules,
      meta: result.pagination
    });
  } catch (error) {
    return next(error);
  }
}

async function getPolicySchedule(req, res, next) {
  try {
    const schedule = await groupService.getPolicyScheduleById(req.params.scheduleId);
    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group policy schedule retrieved successfully',
      data: schedule
    });
  } catch (error) {
    return next(error);
  }
}

async function createPolicySchedule(req, res, next) {
  try {
    const schedule = await groupService.createPolicySchedule(req.body || {});
    await groupPolicyScheduler.refresh();
    return sendSuccess(res, {
      statusCode: 201,
      message: 'Group policy schedule created successfully',
      data: schedule
    });
  } catch (error) {
    return next(error);
  }
}

async function updatePolicySchedule(req, res, next) {
  try {
    const schedule = await groupService.updatePolicySchedule(req.params.scheduleId, req.body || {});
    await groupPolicyScheduler.refresh();
    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group policy schedule updated successfully',
      data: schedule
    });
  } catch (error) {
    return next(error);
  }
}

async function deletePolicySchedule(req, res, next) {
  try {
    const result = await groupService.deletePolicySchedule(req.params.scheduleId);
    await groupPolicyScheduler.refresh();
    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group policy schedule deleted successfully',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function runPolicySchedule(req, res, next) {
  try {
    const result = await groupService.runPolicySchedule(req.params.scheduleId, {
      initiatedBy: req.admin?.username || null,
      source: 'MANUAL'
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: result.result?.dryRun ? 'Schedule run completed in dry-run mode' : 'Schedule run completed successfully',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function listPolicyRollouts(req, res, next) {
  try {
    const result = await groupService.listPolicyRollouts({
      page: req.query.page,
      limit: req.query.limit,
      groupId: req.query.groupId,
      scheduleId: req.query.scheduleId,
      status: req.query.status,
      source: req.query.source
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Group policy rollouts retrieved successfully',
      data: result.rollouts,
      meta: result.pagination
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  addUsers,
  removeUsers,
  moveUsers,
  setInbounds,
  applyPolicy,
  listPolicyTemplates,
  getPolicyTemplate,
  createPolicyTemplate,
  updatePolicyTemplate,
  deletePolicyTemplate,
  applyPolicyTemplate,
  listPolicySchedules,
  getPolicySchedule,
  createPolicySchedule,
  updatePolicySchedule,
  deletePolicySchedule,
  runPolicySchedule,
  listPolicyRollouts
};
