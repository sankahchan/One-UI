const outboundService = require('../services/outbound.service');
const ApiResponse = require('../utils/response');

class OutboundController {
  async list(req, res, next) {
    try {
      const result = await outboundService.list({
        page: req.query?.page ? parseInt(req.query.page) : 1,
        limit: req.query?.limit ? parseInt(req.query.limit) : 50
      });
      res.json(ApiResponse.success(result.items, 'Outbounds retrieved', { pagination: result.pagination }));
    } catch (error) { next(error); }
  }

  async getById(req, res, next) {
    try {
      const outbound = await outboundService.getById(parseInt(req.params.id));
      res.json(ApiResponse.success(outbound));
    } catch (error) { next(error); }
  }

  async create(req, res, next) {
    try {
      const outbound = await outboundService.create(req.body);
      res.status(201).json(ApiResponse.success(outbound, 'Outbound created'));
    } catch (error) { next(error); }
  }

  async update(req, res, next) {
    try {
      const outbound = await outboundService.update(parseInt(req.params.id), req.body);
      res.json(ApiResponse.success(outbound, 'Outbound updated'));
    } catch (error) { next(error); }
  }

  async remove(req, res, next) {
    try {
      await outboundService.delete(parseInt(req.params.id));
      res.json(ApiResponse.success(null, 'Outbound deleted'));
    } catch (error) { next(error); }
  }

  async toggle(req, res, next) {
    try {
      const outbound = await outboundService.toggle(parseInt(req.params.id));
      res.json(ApiResponse.success(outbound, `Outbound ${outbound.enabled ? 'enabled' : 'disabled'}`));
    } catch (error) { next(error); }
  }
}

module.exports = new OutboundController();
