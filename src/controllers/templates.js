function createTemplateController(service) {
  return {
    categories(req, res) { res.json(service.categories()); },
    async list(req, res) { res.json(await service.list(req.input)); },
    async create(req, res) { res.status(201).json(await service.create(req.input)); },
    async remove(req, res) {
      await service.remove(req.habitId);
      res.sendStatus(204);
    },
  };
}

module.exports = { createTemplateController };
