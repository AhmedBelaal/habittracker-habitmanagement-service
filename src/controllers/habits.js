function createHabitController(service, auth) {
  return {
    async create(req, res) { res.status(201).json(await service.create(req.context, req.input)); },
    async list(req, res) { res.json(await service.list(req.context, req.input)); },
    async get(req, res) { res.json(await service.get(req.context, req.habitId)); },
    async edit(req, res) { res.json(await service.edit(req.context, req.habitId, req.input)); },
    async remove(req, res) {
      await service.remove(req.context, req.habitId);
      res.sendStatus(204);
    },
    transition: action => async (req, res) => {
      res.json(await service.transition(req.context, req.habitId, action, req.input.until));
    },
    async tags(req, res) { res.json(await service.tags(req.context)); },
    async due(req, res) { res.json(await service.due(req.context, req.input.date)); },
    async adopt(req, res) { res.status(201).json(await service.adopt(req.context, req.habitId, req.input)); },
    async internalList(req, res) {
      res.json(await service.internalList(auth.forUser(req, req.input.userId), req.input));
    },
    async internalDue(req, res) {
      res.json(await service.due(auth.forUser(req, req.input.userId), req.input.date));
    },
    async internalGet(req, res) {
      if (req.context.legacy) return res.json(await service.legacyGet(req.habitId));
      return res.json(await service.get(auth.forUser(req, req.input.userId), req.habitId));
    },
    async inactivePeriods(req, res) {
      res.json(await service.inactivePeriods(auth.forUser(req, req.input.userId), req.habitId));
    },
    async legacyList(req, res) { res.json(await service.legacyList(req.params.userId)); },
    async stats(req, res) { res.json(await service.stats(req.input.range)); },
  };
}

module.exports = { createHabitController };
